from __future__ import annotations

import logging
from typing import Protocol

log = logging.getLogger(__name__)


class SendError(Exception):
    def __init__(self, message: str, *, retryable: bool = True):
        super().__init__(message)
        self.retryable = retryable


class MessageSender(Protocol):
    def send(self, to: str, template: str, variables: list[str]) -> tuple[str, str]:
        """يرسل رسالة قالب ويُرجع (اسم المزوّد، معرّف الرسالة لديه)."""


class ConsoleSender:
    """للتطوير: يطبع الرسالة بدل إرسالها."""

    name = "CONSOLE"

    def send(self, to: str, template: str, variables: list[str]) -> tuple[str, str]:
        log.info("[%s] → %s | %s | %s", self.name, to, template, variables)
        return self.name, f"console-{abs(hash((to, template, tuple(variables))))}"

    def send_text(self, to: str, body: str) -> tuple[str, str]:
        log.info("[%s] → %s | نص حر | %s", self.name, to, body[:200])
        return self.name, f"console-{abs(hash((to, body)))}"
