from __future__ import annotations

import logging
from typing import Iterable, Sequence

from pythonosc.udp_client import SimpleUDPClient

logger = logging.getLogger(__name__)


class OscSender:
    """
    Thin wrapper around python-osc to standardize all outbound messages.

    Two modes:
    - Solo: stream full network activations continuously
    - Crowd: send per-user chord triggers (output only) on demand
    """

    def __init__(self, host: str = "127.0.0.1", port: int = 57120) -> None:
        self.client = SimpleUDPClient(host, port)
        self.host = host
        self.port = port

    def send_solo_activations(
        self,
        hidden1: Sequence[float],
        hidden2: Sequence[float],
        output: Sequence[float],
    ) -> None:
        """
        Stream all layers to MaxMSP.

        Messages:
            /solo/hidden1  -> 128 floats
            /solo/hidden2  -> 64 floats
            /solo/output   -> 10 floats
        """

        try:
            self._send_vector("/solo/hidden1", hidden1)
            self._send_vector("/solo/hidden2", hidden2)
            self._send_vector("/solo/output", output)
            prediction = max(range(len(output)), key=lambda i: output[i])
            logger.info(
                "OSC solo → hidden1[%d] hidden2[%d] output[%d] (pred: %d, conf: %.1f%%)",
                len(hidden1),
                len(hidden2),
                len(output),
                prediction,
                max(output) * 100,
            )
        except OSError as exc:
            logger.error("OSC solo send failed (%s:%s): %s", self.host, self.port, exc)

    def send_crowd_chord(
        self,
        instrument: str,
        username: str,
        output: Sequence[float],
    ) -> None:
        """
        Send a single participant's chord on trigger.

        Message pattern:
            /crowd/<instrument>/chord  <username> <amp0> ... <amp9>
        """

        safe_instrument = instrument.lower().strip() or "pad"
        address = f"/crowd/{safe_instrument}/chord"
        payload: list[float | str] = [username or "anon"]
        payload.extend(float(v) for v in output)
        try:
            self.client.send_message(address, payload)
            logger.info(
                "OSC crowd → %s [%s] (user: %s, top: %.1f%%)",
                address,
                len(output),
                username or "anon",
                max(output) * 100,
            )
        except OSError as exc:
            logger.error(
                "OSC crowd send failed (%s:%s -> %s): %s",
                self.host,
                self.port,
                address,
                exc,
            )

    # ----------------------------------------------------------------- utils --
    def _send_vector(self, address: str, values: Iterable[float]) -> None:
        """Normalize iterables to floats and send as a single OSC list."""
        payload = [float(v) for v in values]
        self.client.send_message(address, payload)

