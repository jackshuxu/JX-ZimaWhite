from __future__ import annotations

import asyncio
import json
import logging
import time

import socketio

from .osc_sender import OscSender
from .state import SessionManager

logger = logging.getLogger(__name__)

# Rate limiting (seconds)
RATE_LIMIT_MS = 80
RATE_LIMIT_SEC = RATE_LIMIT_MS / 1000

# Inactivity timeout (seconds)
INACTIVITY_TIMEOUT_SEC = 120
CLEANUP_INTERVAL_SEC = 10

sio = socketio.AsyncServer(
    async_mode="asgi",
    cors_allowed_origins="*",
    ping_interval=20,
    ping_timeout=60,
    json=json,
)

manager = SessionManager()
osc = OscSender()

# Per-socket timestamps for rate limiting
_last_canvas: dict[str, float] = {}
_last_trigger: dict[str, float] = {}


def _rate_ok(store: dict[str, float], sid: str) -> bool:
    now = time.monotonic()
    last = store.get(sid, 0)
    if now - last < RATE_LIMIT_SEC:
        return False
    store[sid] = now
    return True


async def _cleanup_inactive():
    """Periodic task to remove participants idle for too long."""
    while True:
        await asyncio.sleep(CLEANUP_INTERVAL_SEC)
        removed = manager.remove_inactive(INACTIVITY_TIMEOUT_SEC)
        if removed:
            logger.info("Removed %d inactive participant(s)", removed)
            await sio.emit("crowd:snapshot", manager.snapshot(), room="crowd")


_cleanup_task: asyncio.Task | None = None


@sio.event
async def connect(sid, environ, auth):
    global _cleanup_task
    if _cleanup_task is None:
        _cleanup_task = asyncio.create_task(_cleanup_inactive())
    logger.info("Socket connected %s", sid)
    await sio.emit("system:welcome", {"socketId": sid}, to=sid)


@sio.event
async def disconnect(sid):
    logger.info("Socket disconnected %s", sid)
    _last_canvas.pop(sid, None)
    _last_trigger.pop(sid, None)
    changed = manager.leave(sid)
    if changed:
        await sio.emit("crowd:snapshot", manager.snapshot(), room="crowd")


# -------------------------------------------------------------------- SOLO MODE
@sio.on("solo:join")
async def handle_solo_join(sid, data):
    await sio.enter_room(sid, "solo")
    await sio.emit(
        "solo:joined",
        {},
        to=sid,
    )
    logger.info("Solo session joined (%s)", sid)


@sio.on("solo:activation")
async def handle_solo_activation(sid, data):
    payload = data or {}
    hidden1 = payload.get("hidden1")
    hidden2 = payload.get("hidden2")
    output = payload.get("output")
    if hidden1 is None or hidden2 is None or output is None:
        logger.debug("Solo activation missing fields: %s", payload)
        return
    osc.send_solo_activations(hidden1, hidden2, output)


# ------------------------------------------------------------------- CROWD MODE
@sio.on("crowd:join")
async def handle_crowd_join(sid, data):
    payload = data or {}
    role = (payload.get("role") or "participant").lower()
    username = payload.get("username") or payload.get("label") or "anonymous"
    instrument = payload.get("instrument") or "pad"

    await sio.enter_room(sid, "crowd")

    if role == "conductor":
        success = manager.join_conductor(sid)
        if not success:
            await sio.emit(
                "crowd:error",
                {"message": "A conductor is already connected."},
                to=sid,
            )
            return
    else:
        manager.join_participant(
            socket_id=sid,
            instrument=instrument,
            username=username,
        )

    await sio.emit(
        "crowd:joined",
        {"role": role},
        to=sid,
    )
    await sio.emit("crowd:snapshot", manager.snapshot(), room="crowd")


@sio.on("canvas:update")
async def handle_canvas_update(sid, data):
    if not _rate_ok(_last_canvas, sid):
        return
    payload = data or {}
    canvas = payload.get("canvas")
    output = payload.get("output")
    instrument = payload.get("instrument")

    updated = manager.update_participant(
        socket_id=sid,
        canvas=canvas,
        output=output,
        instrument=instrument,
    )
    if not updated:
        return
    await sio.emit("crowd:snapshot", manager.snapshot(), room="crowd")


@sio.on("chord:trigger")
async def handle_chord_trigger(sid, data):
    if not _rate_ok(_last_trigger, sid):
        return
    payload = data or {}
    output = payload.get("output")
    instrument = payload.get("instrument")
    if output is not None or instrument is not None:
        manager.update_participant(
            socket_id=sid,
            canvas=None,
            output=output,
            instrument=instrument,
        )

    chord = manager.get_chord_for_trigger(sid)
    participant = manager.get_participant(sid)
    if not chord or not participant:
        return

    osc.send_crowd_chord(
        instrument=chord.instrument,
        username=participant.username,
        output=chord.output,
    )
    await sio.emit(
        "chord:played",
        {
            "socketId": sid,
            "instrument": chord.instrument,
        },
        room="crowd",
    )

