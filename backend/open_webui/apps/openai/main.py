import asyncio
import hashlib
import json
import logging
from pathlib import Path
from typing import Literal, Optional, overload
from fastapi.responses import StreamingResponse
import aiohttp
import aiofiles
from open_webui.apps.webui.models.models import Models
from fastapi import HTTPException, BackgroundTasks, Depends
from open_webui.config import (
    CACHE_DIR,
    CORS_ALLOW_ORIGIN,
    ENABLE_MODEL_FILTER,
    ENABLE_OPENAI_API,
    MODEL_FILTER_LIST,
    OPENAI_API_BASE_URLS,
    OPENAI_API_KEYS,
    AppConfig,
)
from open_webui.env import (
    AIOHTTP_CLIENT_TIMEOUT,
    AIOHTTP_CLIENT_TIMEOUT_OPENAI_MODEL_LIST,
)

from open_webui.constants import ERROR_MESSAGES
from open_webui.env import SRC_LOG_LEVELS
from fastapi import Depends, FastAPI, HTTPException, Request
from fastapi.middleware.cors import CORSMiddleware
from fastapi.responses import FileResponse, StreamingResponse
from pydantic import BaseModel
from starlette.background import BackgroundTask

from open_webui.utils.payload import (
    apply_model_params_to_body_openai,
    apply_model_system_prompt_to_body,
)

from open_webui.utils.utils import get_admin_user, get_verified_user

log = logging.getLogger(__name__)
log.setLevel(SRC_LOG_LEVELS["OPENAI"])

app = FastAPI()
app.add_middleware(
    CORSMiddleware,
    allow_origins=CORS_ALLOW_ORIGIN,
    allow_credentials=True,
    allow_methods=["*"],
    allow_headers=["*"],
)

app.state.config = AppConfig()

app.state.config.ENABLE_MODEL_FILTER = ENABLE_MODEL_FILTER
app.state.config.MODEL_FILTER_LIST = MODEL_FILTER_LIST

app.state.config.ENABLE_OPENAI_API = ENABLE_OPENAI_API
app.state.config.OPENAI_API_BASE_URLS = OPENAI_API_BASE_URLS
app.state.config.OPENAI_API_KEYS = OPENAI_API_KEYS

app.state.MODELS = {}
app.state.MODEL_CACHE = {}
app.state.MODEL_CACHE_TIME = 0

async def preload_models():
    await get_all_models()

@app.on_event("startup")
async def startup_event():
    await preload_models()

@app.middleware("http")
async def check_url(request: Request, call_next):
    response = await call_next(request)
    return response

@app.get("/config")
async def get_config(user=Depends(get_admin_user)):
    return {"ENABLE_OPENAI_API": app.state.config.ENABLE_OPENAI_API}

class OpenAIConfigForm(BaseModel):
    enable_openai_api: Optional[bool] = None

@app.post("/config/update")
async def update_config(form_data: OpenAIConfigForm, user=Depends(get_admin_user)):
    app.state.config.ENABLE_OPENAI_API = form_data.enable_openai_api
    return {"ENABLE_OPENAI_API": app.state.config.ENABLE_OPENAI_API}

class UrlsUpdateForm(BaseModel):
    urls: list[str]

class KeysUpdateForm(BaseModel):
    keys: list[str]

@app.get("/urls")
async def get_openai_urls(user=Depends(get_admin_user)):
    return {"OPENAI_API_BASE_URLS": app.state.config.OPENAI_API_BASE_URLS}

@app.post("/urls/update")
async def update_openai_urls(form_data: UrlsUpdateForm, user=Depends(get_admin_user)):
    app.state.config.OPENAI_API_BASE_URLS = form_data.urls
    await preload_models()
    return {"OPENAI_API_BASE_URLS": app.state.config.OPENAI_API_BASE_URLS}

@app.get("/keys")
async def get_openai_keys(user=Depends(get_admin_user)):
    return {"OPENAI_API_KEYS": app.state.config.OPENAI_API_KEYS}

@app.post("/keys/update")
async def update_openai_key(form_data: KeysUpdateForm, user=Depends(get_admin_user)):
    app.state.config.OPENAI_API_KEYS = form_data.keys
    return {"OPENAI_API_KEYS": app.state.config.OPENAI_API_KEYS}

@app.post("/audio/speech")
async def speech(request: Request, user=Depends(get_verified_user)):
    idx = None
    try:
        idx = app.state.config.OPENAI_API_BASE_URLS.index("https://api.openai.com/v1")
        body = await request.body()
        name = hashlib.sha256(body).hexdigest()

        SPEECH_CACHE_DIR = Path(CACHE_DIR).joinpath("./audio/speech/")
        SPEECH_CACHE_DIR.mkdir(parents=True, exist_ok=True)
        file_path = SPEECH_CACHE_DIR.joinpath(f"{name}.mp3")
        file_body_path = SPEECH_CACHE_DIR.joinpath(f"{name}.json")

        if file_path.is_file():
            return FileResponse(file_path)

        headers = {
            "Authorization": f"Bearer {app.state.config.OPENAI_API_KEYS[idx]}",
            "Content-Type": "application/json",
        }
        if "openrouter.ai" in app.state.config.OPENAI_API_BASE_URLS[idx]:
            headers["HTTP-Referer"] = "https://openwebui.com/"
            headers["X-Title"] = "ChatK"

        async with aiohttp.ClientSession() as session:
            async with session.post(
                url=f"{app.state.config.OPENAI_API_BASE_URLS[idx]}/audio/speech",
                data=body,
                headers=headers,
            ) as r:
                r.raise_for_status()
                async with aiofiles.open(file_path, mode='wb') as f:
                    async for chunk in r.content.iter_chunked(8192):
                        await f.write(chunk)

        async with aiofiles.open(file_body_path, mode='w') as f:
            await f.write(json.dumps(json.loads(body.decode("utf-8"))))

        return FileResponse(file_path)

    except Exception as e:
        log.error(f"Error in speech function: {e}")
        raise HTTPException(status_code=500, detail="Internal Server Error")

async def fetch_url(url, key):
    timeout = aiohttp.ClientTimeout(total=AIOHTTP_CLIENT_TIMEOUT_OPENAI_MODEL_LIST)
    try:
        headers = {"Authorization": f"Bearer {key}"}
        async with aiohttp.ClientSession(timeout=timeout, trust_env=True) as session:
            async with session.get(url, headers=headers) as response:
                return await response.json()
    except Exception as e:
        log.error(f"Connection error: {e}")
        return None

async def cleanup_response(
    response: Optional[aiohttp.ClientResponse],
    session: Optional[aiohttp.ClientSession],
):
    if response:
        await response.release()
    if session:
        await session.close()

def merge_models_lists(model_lists):
    merged_list = []
    for idx, models in enumerate(model_lists):
        if models is not None and "error" not in models:
            merged_list.extend(
                [
                    {
                        **model,
                        "name": model.get("name", model["id"]),
                        "owned_by": "openai",
                        "openai": model,
                        "urlIdx": idx,
                    }
                    for model in models
                    if "api.openai.com"
                    not in app.state.config.OPENAI_API_BASE_URLS[idx]
                    or not any(
                        name in model["id"]
                        for name in [
                            "babbage",
                            "dall-e",
                            "davinci",
                            "embedding",
                            "tts",
                            "whisper",
                        ]
                    )
                ]
            )
    return merged_list

def is_openai_api_disabled():
    return not app.state.config.ENABLE_OPENAI_API

async def get_all_models_raw() -> list:
    if is_openai_api_disabled():
        return []

    num_urls = len(app.state.config.OPENAI_API_BASE_URLS)
    num_keys = len(app.state.config.OPENAI_API_KEYS)

    if num_keys != num_urls:
        if num_keys > num_urls:
            app.state.config.OPENAI_API_KEYS = app.state.config.OPENAI_API_KEYS[:num_urls]
        else:
            app.state.config.OPENAI_API_KEYS += [""] * (num_urls - num_keys)

    tasks = [
        fetch_url(f"{url}/models", app.state.config.OPENAI_API_KEYS[idx])
        for idx, url in enumerate(app.state.config.OPENAI_API_BASE_URLS)
    ]

    responses = await asyncio.gather(*tasks)
    return responses

@overload
async def get_all_models(raw: Literal[True]) -> list: ...

@overload
async def get_all_models(raw: Literal[False] = False) -> dict[str, list]: ...

async def get_all_models(raw=False) -> dict[str, list] | list:
    if is_openai_api_disabled():
        return [] if raw else {"data": []}

    current_time = asyncio.get_event_loop().time()
    if current_time - app.state.MODEL_CACHE_TIME < 300:  # 5 minutes cache
        return app.state.MODEL_CACHE if raw else {"data": app.state.MODEL_CACHE}

    responses = await get_all_models_raw()
    if raw:
        app.state.MODEL_CACHE = responses
        app.state.MODEL_CACHE_TIME = current_time
        return responses

    def extract_data(response):
        if response and "data" in response:
            return response["data"]
        if isinstance(response, list):
            return response
        return None

    models = {"data": merge_models_lists(map(extract_data, responses))}
    app.state.MODELS = {model["id"]: model for model in models["data"]}
    app.state.MODEL_CACHE = models["data"]
    app.state.MODEL_CACHE_TIME = current_time

    return models

@app.get("/models")
@app.get("/models/{url_idx}")
async def get_models(url_idx: Optional[int] = None, user=Depends(get_verified_user)):
    if url_idx is None:
        models = await get_all_models()
        if app.state.config.ENABLE_MODEL_FILTER and user.role == "user":
            models["data"] = [model for model in models["data"] if model["id"] in app.state.config.MODEL_FILTER_LIST]
        return models

    url = app.state.config.OPENAI_API_BASE_URLS[url_idx]
    key = app.state.config.OPENAI_API_KEYS[url_idx]
    headers = {
        "Authorization": f"Bearer {key}",
        "Content-Type": "application/json"
    }

    async with aiohttp.ClientSession() as session:
        async with session.get(f"{url}/models", headers=headers) as r:
            r.raise_for_status()
            response_data = await r.json()

            if "api.openai.com" in url:
                response_data["data"] = [
                    model for model in response_data["data"]
                    if not any(name in model["id"] for name in ["babbage", "dall-e", "davinci", "embedding", "tts", "whisper"])
                ]

            return response_data


@app.post("/chat/completions")
@app.post("/chat/completions/{url_idx}")
async def generate_chat_completion(
    form_data: dict,
    url_idx: Optional[int] = None,
    user=Depends(get_verified_user),
):
    idx = 0
    payload = {**form_data}

    if "metadata" in payload:
        del payload["metadata"]

    model_id = form_data.get("model")
    model_info = Models.get_model_by_id(model_id)

    if model_info:
        if model_info.base_model_id:
            payload["model"] = model_info.base_model_id

        params = model_info.params.model_dump()
        payload = apply_model_params_to_body_openai(params, payload)
        payload = apply_model_system_prompt_to_body(params, payload, user)

    model = app.state.MODELS[payload.get("model")]
    idx = model["urlIdx"]

    if "pipeline" in model and model.get("pipeline"):
        payload["user"] = {
            "name": user.name,
            "id": user.id,
            "email": user.email,
            "role": user.role,
        }

    # 检查并修正 temperature 参数
    if payload["model"].lower().startswith("o1-"):
        if "temperature" in payload and payload["temperature"] != 1:
            # 如果模型只支持默认值 1，则强制设置为 1
            payload["temperature"] = 1
         # 检查并删除 messages[0].role 参数为 "system" 的消息
        if "messages" in payload and len(payload["messages"]) > 0:
            if payload["messages"][0].get("role") == "system":
                # 如果模型不支持 role = "system"，直接删除该消息
                del payload["messages"][0]
       

    url = app.state.config.OPENAI_API_BASE_URLS[idx]
    key = app.state.config.OPENAI_API_KEYS[idx]
    is_o1 = payload["model"].lower().startswith("o1-")

    # Change max_completion_tokens to max_tokens (Backward compatible)
    if "api.openai.com" not in url and not is_o1:
        if "max_completion_tokens" in payload:
            # Remove "max_completion_tokens" from the payload
            payload["max_tokens"] = payload["max_completion_tokens"]
            del payload["max_completion_tokens"]
    else:
        if is_o1 and "max_tokens" in payload:
            payload["max_completion_tokens"] = payload["max_tokens"]
            del payload["max_tokens"]
        if "max_tokens" in payload and "max_completion_tokens" in payload:
            del payload["max_tokens"]

    # Fix: O1 does not support the "system" parameter, Modify "system" to "user"
    if is_o1 and payload["messages"][0]["role"] == "system":
        payload["messages"][0]["role"] = "user"

    # Convert the modified body back to JSON
    payload = json.dumps(payload)

    log.debug(payload)

    headers = {}
    headers["Authorization"] = f"Bearer {key}"
    headers["Content-Type"] = "application/json"
    if "openrouter.ai" in app.state.config.OPENAI_API_BASE_URLS[idx]:
        headers["HTTP-Referer"] = "https://openwebui.com/"
        headers["X-Title"] = "Open WebUI"

    r = None
    session = None
    streaming = False
    response = None

    try:
        session = aiohttp.ClientSession(
            trust_env=True, timeout=aiohttp.ClientTimeout(total=AIOHTTP_CLIENT_TIMEOUT)
        )
        r = await session.request(
            method="POST",
            url=f"{url}/chat/completions",
            data=payload,
            headers=headers,
        )

        # Check if response is SSE
        if "text/event-stream" in r.headers.get("Content-Type", ""):
            streaming = True
            return StreamingResponse(
                r.content,
                status_code=r.status,
                headers=dict(r.headers),
                background=BackgroundTask(
                    cleanup_response, response=r, session=session
                ),
            )
        else:
            try:
                response = await r.json()
            except Exception as e:
                log.error(e)
                response = await r.text()

            r.raise_for_status()
            return response
    except Exception as e:
        log.exception(e)
        error_detail = "ChatK: Server Connection Error"
        if isinstance(response, dict):
            if "error" in response:
                error_detail = f"{response['error']['message'] if 'message' in response['error'] else response['error']}"
        elif isinstance(response, str):
            error_detail = response

        raise HTTPException(status_code=r.status if r else 500, detail=error_detail)
    finally:
        if not streaming and session:
            if r:
                r.close()
            await session.close()

            
@app.api_route("/{path:path}", methods=["GET", "POST", "PUT", "DELETE"])
async def proxy(path: str, request: Request, user=Depends(get_verified_user)):
    idx = 0
    body = await request.body()
    url = app.state.config.OPENAI_API_BASE_URLS[idx]
    key = app.state.config.OPENAI_API_KEYS[idx]
    target_url = f"{url}/{path}"

    headers = {
        "Authorization": f"Bearer {key}",
        "Content-Type": "application/json"
    }

    async with aiohttp.ClientSession(trust_env=True) as session:
        async with session.request(
            method=request.method,
            url=target_url,
            data=body,
            headers=headers,
        ) as r:
            r.raise_for_status()

            if "text/event-stream" in r.headers.get("Content-Type", ""):
                return StreamingResponse(
                    r.content,
                    status_code=r.status,
                    headers=dict(r.headers),
                    background=BackgroundTask(cleanup_response, response=r, session=session),
                )
            else:
                return await r.json()