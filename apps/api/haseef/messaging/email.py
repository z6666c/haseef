"""مزوّد البريد عبر SMTP (أي مزوّد يدعمه، ويفضَّل مزوّد داخل المملكة)."""

from __future__ import annotations

import smtplib
import ssl
import uuid
from email.message import EmailMessage
from email.utils import make_msgid

from .base import SendError
from ..domain.email_templates import render


class SmtpEmail:
    name = "SMTP"

    def __init__(self, host: str, port: int, user: str | None, password: str | None, sender: str, starttls: bool = True):
        self.host, self.port, self.user, self.password, self.sender, self.starttls = host, port, user, password, sender, starttls

    def send(self, to: str, template: str, variables: list[str]) -> tuple[str, str]:
        subject, body = render(template, variables)
        msg = EmailMessage()
        msg["From"], msg["To"], msg["Subject"] = self.sender, to, subject
        mid = make_msgid(idstring=uuid.uuid4().hex[:12], domain="haseef.sa")
        msg["Message-ID"] = mid
        msg.set_content(body)
        html = "<div dir='rtl' style='font-family:Tahoma,Arial,sans-serif;font-size:15px;line-height:1.8'>" + \
            "<br>".join(body.replace("&", "&amp;").replace("<", "&lt;").splitlines()) + "</div>"
        msg.add_alternative(html, subtype="html")
        try:
            with smtplib.SMTP(self.host, self.port, timeout=20) as s:
                if self.starttls:
                    s.starttls(context=ssl.create_default_context())
                if self.user:
                    s.login(self.user, self.password or "")
                s.send_message(msg)
        except smtplib.SMTPRecipientsRefused as e:
            raise SendError(f"SMTP recipient refused: {e}", retryable=False) from e
        except (smtplib.SMTPException, OSError) as e:
            raise SendError(f"SMTP error: {e}") from e
        return self.name, mid
