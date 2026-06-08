# rifas-mailer (Render)

Microservicio para enviar correos vía Gmail SMTP desde Render.

## ⚠️ Importante: Requiere Plan Pago de Render

**Render's free tier bloquea los puertos SMTP 25, 465 y 587.** Para usar Gmail SMTP necesitas un plan pago de Render.

## Endpoints

- `GET /health`
- `POST /send` (requiere header `x-api-key`)

### POST /send body

```json
{
  "to": "destinatario@email.com",
  "subject": "Asunto",
  "html": "<b>hola</b>",
  "from": "Rifas Premium <winnergorifas@gmail.com>",
  "attachments": [
    {
      "filename": "ticket-0001.pdf",
      "contentType": "application/pdf",
      "contentBase64": "JVBERi0xLjcKJc..."
    }
  ]
}
```

## Variables de entorno (Render)

### Requeridas
- `MAILER_API_KEY` (secreto; debe coincidir con el backend)
- `SMTP_USER` - Tu Gmail
- `SMTP_PASS` - App Password de Gmail (no tu contraseña normal)

### Opcionales
- `SMTP_HOST` - Servidor SMTP (default: `smtp.gmail.com`)
- `SMTP_FROM` - Email remitente (default: usa SMTP_USER)
- `MAILER_PROVIDERS_PRIORITY` - Proveedores (default: `gmail`)
- `SMTP_CONNECTION_TIMEOUT` - Timeout conexión SMTP (default: 10000ms)
- `SMTP_GREETING_TIMEOUT` - Timeout greeting SMTP (default: 10000ms)
- `SMTP_SOCKET_TIMEOUT` - Timeout socket SMTP (default: 15000ms)

## Configuración Gmail SMTP

1. **Generar App Password de Gmail:**
   - Ve a https://myaccount.google.com/security
   - Activa "Verificación en dos pasos"
   - Ve a "Contraseñas de aplicaciones"
   - Genera una nueva contraseña para "Mailer"

2. **Configurar en Render:**
   ```
   MAILER_API_KEY=tu-api-key-secreta
   SMTP_USER=tu-email@gmail.com
   SMTP_PASS=tu-app-password-generada
   ```

3. **Actualizar a Plan Pago de Render:**
   - Ve a tu dashboard de Render
   - Actualiza el web service a "Starter" o superior
   - Esto desbloqueará los puertos SMTP 587 y 465

## Render

Crea un **Web Service** en Render apuntando a la carpeta `mailer_service`.

- Build Command: `npm install`
- Start Command: `npm start`

Luego copia la URL pública de Render y configúrala en tu backend como `MAILER_SERVICE_URL`.
