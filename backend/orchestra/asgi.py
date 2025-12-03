"""
ASGI config for orchestra project.

It exposes the ASGI callable as a module-level variable named ``application``.

For more information on this file, see
https://docs.djangoproject.com/en/5.1/howto/deployment/asgi/
"""

import os

os.environ.setdefault('DJANGO_SETTINGS_MODULE', 'orchestra.settings')

import socketio
from django.core.asgi import get_asgi_application

from core.socket_server import sio

django_app = get_asgi_application()
socket_app = socketio.ASGIApp(sio, django_app)
application = socket_app
