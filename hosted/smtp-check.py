#!/usr/bin/env python3
"""Checks the SMTP login Supabase uses, without sending anything.

    python3 hosted/smtp-check.py [address]

Asks for the Proton SMTP token without echoing it.
"""
import getpass
import smtplib
import sys

user = sys.argv[1] if len(sys.argv) > 1 else "openboard@philipmackie.ca"
token = getpass.getpass(f"SMTP token for {user}: ")
s = smtplib.SMTP("smtp.protonmail.ch", 587, timeout=20)
s.starttls()
try:
    s.login(user, token)
    print("Login OK: the token works for", user)
except smtplib.SMTPAuthenticationError as e:
    print("Login refused:", e.smtp_code, e.smtp_error.decode(errors="replace"))
finally:
    s.quit()
