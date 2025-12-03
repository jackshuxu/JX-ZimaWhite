from __future__ import annotations

from dataclasses import dataclass, field
from datetime import datetime
from typing import Optional


@dataclass
class ChordPayload:
    """A triggered chord from a participant - output layer values + instrument."""
    output: list[float]  # 10 values, one per digit (0-9)
    instrument: str


@dataclass
class ParticipantState:
    """State for a single participant drawing digits."""
    socket_id: str
    instrument: str = "pad"
    username: str = "anonymous"
    canvas: Optional[str] = None  # base64 PNG data URL
    output: Optional[list[float]] = None  # Latest output layer (10 values)
    last_seen: datetime = field(default_factory=datetime.utcnow)


class SessionState:
    """State for a single session (one QR code = one session)."""

    def __init__(self, session_id: str):
        self.session_id = session_id
        self.participants: dict[str, ParticipantState] = {}
        self.conductor_socket_id: Optional[str] = None  # Single conductor (the host)

    def serialize(self) -> dict:
        """Convert to JSON-serializable dict for sending over WebSocket."""
        return {
            "sessionId": self.session_id,
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
            "hasConductor": self.conductor_socket_id is not None,
            "participantCount": len(self.participants),
        }

    def get_participant_chord(self, socket_id: str) -> Optional[ChordPayload]:
        """Get a participant's current output as a chord for triggering."""
        participant = self.participants.get(socket_id)
        if not participant or not participant.output:
            return None
        return ChordPayload(
            output=participant.output,
            instrument=participant.instrument,
        )


class SessionManager:
    """Manages all active sessions."""

    def __init__(self):
        self.sessions: dict[str, SessionState] = {}

    def _get_or_create(self, session_id: str) -> SessionState:
        if session_id not in self.sessions:
            self.sessions[session_id] = SessionState(session_id)
        return self.sessions[session_id]

    def join_participant(
        self,
        session_id: str,
        socket_id: str,
        instrument: str,
        username: str,
    ) -> SessionState:
        """Add a participant to a session."""
        session = self._get_or_create(session_id)
        session.participants[socket_id] = ParticipantState(
            socket_id=socket_id,
            instrument=instrument,
            username=username or "anonymous",
        )
        return session

    def join_conductor(self, session_id: str, socket_id: str) -> tuple[SessionState, bool]:
        """
        Set the conductor for a session.
        Returns (session, success). Success is False if a conductor already exists.
        """
        session = self._get_or_create(session_id)
        if session.conductor_socket_id is not None:
            return session, False  # Already has a conductor
        session.conductor_socket_id = socket_id
        return session, True

    def update_participant(
        self,
        session_id: str,
        socket_id: str,
        canvas: Optional[str] = None,
        output: Optional[list[float]] = None,
        instrument: Optional[str] = None,
    ) -> Optional[SessionState]:
        """Update a participant's canvas/output."""
        session = self.sessions.get(session_id)
        if not session:
            return None
        participant = session.participants.get(socket_id)
        if not participant:
            return None
        if canvas is not None:
            participant.canvas = canvas
        if output is not None:
            participant.output = output
        if instrument is not None:
            participant.instrument = instrument
        participant.last_seen = datetime.utcnow()
        return session

    def get_chord_for_trigger(
        self,
        session_id: str,
        socket_id: str,
    ) -> Optional[ChordPayload]:
        """Get a participant's chord data when they press the trigger."""
        session = self.sessions.get(session_id)
        if not session:
            return None
        return session.get_participant_chord(socket_id)

    def leave(self, socket_id: str) -> list[str]:
        """Remove a socket from all sessions. Returns affected session IDs."""
        touched: set[str] = set()
        for session_id, session in list(self.sessions.items()):
            if socket_id in session.participants:
                del session.participants[socket_id]
                touched.add(session_id)
            if session.conductor_socket_id == socket_id:
                session.conductor_socket_id = None
                touched.add(session_id)
            # Clean up empty sessions
            if not session.participants and session.conductor_socket_id is None:
                del self.sessions[session_id]
        return list(touched)

    def snapshot(self, session_id: str) -> Optional[dict]:
        """Get serialized snapshot of a session."""
        if session_id not in self.sessions:
            return None
        return self.sessions[session_id].serialize()
