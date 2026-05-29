# rifas-mailer (Render)

Microservicio para enviar correos vía SMTP (Gmail) desde Render.

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

- `MAILER_API_KEY` (secreto; debe coincidir con el backend)
- `SMTP_HOST` (ej. `smtp.gmail.com`)
- `SMTP_PORT` (587 o 465)
- `SMTP_SECURE` (`true` para 465, `false` para 587)
- `SMTP_USER` (tu gmail)
- `SMTP_PASS` (App Password de Gmail)
- `SMTP_FROM` (opcional)

## Render

Crea un **Web Service** en Render apuntando a la carpeta `mailer_service`.

- Build Command: `npm install`
- Start Command: `npm start`

Luego copia la URL pública de Render y configúrala en tu backend como `MAILER_SERVICE_URL`.
