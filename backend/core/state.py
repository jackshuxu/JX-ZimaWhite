from __future__ import annotations

from dataclasses import dataclass, field
from datetime import datetime, timedelta
from typing import Optional


@dataclass
class ChordPayload:
    """Triggered chord data - output layer + instrument."""

    output: list[float]
    instrument: str


@dataclass
class ParticipantState:
    """State for a single participant drawing digits."""

    socket_id: str
    instrument: str = "pad"
    username: str = "anonymous"
    canvas: Optional[str] = None  # base64 PNG
    output: Optional[list[float]] = None  # Latest NN output (10 values)
    last_seen: datetime = field(default_factory=datetime.utcnow)


class GlobalState:
    """Single-show state shared by everyone."""

    def __init__(self):
        self.participants: dict[str, ParticipantState] = {}
        self.conductor_socket_id: Optional[str] = None

    def serialize(self) -> dict:
        """JSON snapshot for frontend consumers."""
        return {
            "participants": [
                {
                    "socketId": p.socket_id,
                    "instrument": p.instrument,
                    "username": p.username,
                    "canvas": p.canvas,
                    "lastSeen": p.last_seen.isoformat(),
                }
                for p in self.participants.values()
            ],
            "participantCount": len(self.participants),
            "hasConductor": self.conductor_socket_id is not None,
            "instrumentMix": self.instrument_mix(),
        }

    def instrument_mix(self) -> dict[str, int]:
        mix: dict[str, int] = {}
        for participant in self.participants.values():
            mix[participant.instrument] = mix.get(participant.instrument, 0) + 1
        return mix

    def get_participant_chord(self, socket_id: str) -> Optional[ChordPayload]:
        participant = self.participants.get(socket_id)
        if not participant or not participant.output:
            return None
        return ChordPayload(
            output=participant.output,
            instrument=participant.instrument,
        )


class SessionManager:
    """
    Maintains global participant + conductor state for the single show.
    (Name kept for compatibility with earlier code.)
    """

    def __init__(self):
        self.state = GlobalState()

    # ---------------------------------------------------------------- participants
    def join_participant(
        self,
        socket_id: str,
        instrument: str,
        username: str,
    ) -> None:
        self.state.participants[socket_id] = ParticipantState(
            socket_id=socket_id,
            instrument=instrument,
            username=username or "anonymous",
        )

    def update_participant(
        self,
        socket_id: str,
        canvas: Optional[str] = None,
        output: Optional[list[float]] = None,
        instrument: Optional[str] = None,
    ) -> bool:
        participant = self.state.participants.get(socket_id)
        if not participant:
            return False
        if canvas is not None:
            participant.canvas = canvas
        if output is not None:
            participant.output = output
        if instrument is not None:
            participant.instrument = instrument
        participant.last_seen = datetime.utcnow()
        return True

    def get_chord_for_trigger(self, socket_id: str) -> Optional[ChordPayload]:
        return self.state.get_participant_chord(socket_id)

    def get_participant(self, socket_id: str) -> Optional[ParticipantState]:
        return self.state.participants.get(socket_id)

    # ---------------------------------------------------------------- conductor
    def join_conductor(self, socket_id: str) -> bool:
        """Returns True if conductor slot granted, False if already taken."""
        if self.state.conductor_socket_id and self.state.conductor_socket_id != socket_id:
            return False
        self.state.conductor_socket_id = socket_id
        return True

    # ---------------------------------------------------------------- teardown
    def leave(self, socket_id: str) -> bool:
        """
        Remove a socket from the show.
        Returns True if the public snapshot changed.
        """
        changed = False
        if socket_id in self.state.participants:
            del self.state.participants[socket_id]
            changed = True
        if self.state.conductor_socket_id == socket_id:
            self.state.conductor_socket_id = None
            changed = True
        return changed

    # ---------------------------------------------------------------- cleanup
    def remove_inactive(self, timeout_sec: float) -> int:
        """Remove participants idle longer than timeout_sec. Returns count removed."""
        cutoff = datetime.utcnow() - timedelta(seconds=timeout_sec)
        to_remove = [
            sid for sid, p in self.state.participants.items() if p.last_seen < cutoff
        ]
        for sid in to_remove:
            del self.state.participants[sid]
        return len(to_remove)

    # ---------------------------------------------------------------- snapshots
    def snapshot(self) -> dict:
        return self.state.serialize()
