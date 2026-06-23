import logging
import httpx
import asyncio
from app.core.config import settings
from app.services.auth_agent import build_sso_app

logger = logging.getLogger("app.services.alerting")

async def send_teams_webhook_alert(message: str):
    """
    Sends an alert message to a Microsoft Teams channel via Webhook.
    """
    if not settings.TEAMS_WEBHOOK_URL:
        logger.debug("TEAMS_WEBHOOK_URL not configured. Skipping Teams alert.")
        return

    payload = {
        "text": message
    }
    try:
        async with httpx.AsyncClient() as client:
            response = await client.post(settings.TEAMS_WEBHOOK_URL, json=payload, timeout=10.0)
            response.raise_for_status()
            logger.info("Successfully sent Teams webhook alert.")
    except Exception as e:
        logger.error(f"Failed to send Teams alert: {e}")

async def send_graph_email_alert(subject: str, html_content: str, to_emails: list[str]):
    """
    Sends an email using Microsoft Graph API utilizing the SSO App's Application permissions (Mail.Send).
    """
    if not settings.ALERT_SENDER_EMAIL or not settings.SSO_CLIENT_ID or not settings.SSO_CLIENT_SECRET:
        logger.debug("Email sender or SSO credentials not fully configured. Skipping Graph Email alert.")
        return

    try:
        app = build_sso_app(settings.SSO_CLIENT_ID, settings.SSO_CLIENT_SECRET, settings.SSO_TENANT_ID)
        result = await asyncio.to_thread(app.acquire_token_for_client, scopes=["https://graph.microsoft.com/.default"])
        
        if "access_token" not in result:
            logger.error(f"Could not acquire token for sending email: {result.get('error_description')}")
            return

        access_token = result["access_token"]
        endpoint = f"https://graph.microsoft.com/v1.0/users/{settings.ALERT_SENDER_EMAIL}/sendMail"
        
        email_payload = {
            "message": {
                "subject": subject,
                "body": {
                    "contentType": "HTML",
                    "content": html_content
                },
                "toRecipients": [
                    {"emailAddress": {"address": email}} for email in to_emails
                ]
            },
            "saveToSentItems": "false"
        }

        headers = {
            "Authorization": f"Bearer {access_token}",
            "Content-Type": "application/json"
        }

        async with httpx.AsyncClient() as client:
            response = await client.post(endpoint, json=email_payload, headers=headers, timeout=15.0)
            response.raise_for_status()
            logger.info("Successfully sent email alert via MS Graph.")
            
    except Exception as e:
        logger.error(f"Failed to send MS Graph email alert: {e}")

async def notify_deployment_event(event_type: str, org_name: str, job_id: str, requester: str = "Unknown", extra_info: str = ""):
    """
    Convenience method to dispatch alerts for deployment lifecycle events to all configured channels.
    """
    # Build content based on event type
    subject = f"[Config Engine] Deployment {event_type.upper()}: {org_name}"
    
    if event_type == "requested":
        msg = f"🚀 **Nuevo Despliegue Solicitado**\n\n**Tenant:** {org_name}\n**Job ID:** {job_id}\n**Solicitante:** {requester}\n\n*Requiere aprobación en el portal.*"
        html = f"<p>🚀 <strong>Nuevo Despliegue Solicitado</strong></p><ul><li><strong>Tenant:</strong> {org_name}</li><li><strong>Job ID:</strong> {job_id}</li><li><strong>Solicitante:</strong> {requester}</li></ul><p><em>Requiere aprobación en el portal.</em></p>"
    elif event_type == "approved":
        msg = f"✅ **Despliegue Aprobado**\n\n**Tenant:** {org_name}\n**Job ID:** {job_id}\n**Aprobador:** {requester}\n\n*El despliegue ha comenzado.*"
        html = f"<p>✅ <strong>Despliegue Aprobado</strong></p><ul><li><strong>Tenant:</strong> {org_name}</li><li><strong>Job ID:</strong> {job_id}</li><li><strong>Aprobador:</strong> {requester}</li></ul><p><em>El despliegue ha comenzado.</em></p>"
    elif event_type == "rejected":
        msg = f"❌ **Despliegue Rechazado**\n\n**Tenant:** {org_name}\n**Job ID:** {job_id}\n**Rechazado por:** {requester}"
        html = f"<p>❌ <strong>Despliegue Rechazado</strong></p><ul><li><strong>Tenant:</strong> {org_name}</li><li><strong>Job ID:</strong> {job_id}</li><li><strong>Rechazado por:</strong> {requester}</li></ul>"
    elif event_type == "completed":
        msg = f"🎉 **Despliegue Finalizado Exitosamente**\n\n**Tenant:** {org_name}\n**Job ID:** {job_id}"
        html = f"<p>🎉 <strong>Despliegue Finalizado Exitosamente</strong></p><ul><li><strong>Tenant:</strong> {org_name}</li><li><strong>Job ID:</strong> {job_id}</li></ul>"
    elif event_type == "failed":
        msg = f"⚠️ **Despliegue Fallido**\n\n**Tenant:** {org_name}\n**Job ID:** {job_id}\n\nDetalles: {extra_info}"
        html = f"<p>⚠️ <strong>Despliegue Fallido</strong></p><ul><li><strong>Tenant:</strong> {org_name}</li><li><strong>Job ID:</strong> {job_id}</li></ul><p>Detalles: {extra_info}</p>"
    else:
        msg = f"Evento de despliegue: {event_type} en {org_name} ({job_id})"
        html = f"<p>Evento de despliegue: {event_type} en {org_name} ({job_id})</p>"

    # Dispatch (fire and forget asynchronously)
    asyncio.create_task(send_teams_webhook_alert(msg))
    
    # Ideally, to_emails would be queried from the DB for users with role 'approver' or 'super_admin'.
    # We will just send it to ALERT_SENDER_EMAIL as a fallback notification inbox for now.
    if settings.ALERT_SENDER_EMAIL:
        asyncio.create_task(send_graph_email_alert(subject, html, [settings.ALERT_SENDER_EMAIL]))
