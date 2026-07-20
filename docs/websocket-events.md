# Eventos WebSocket

El servidor usa Socket.IO para comunicación en tiempo real.

## Conexión

```
URL: http://localhost:4002 (mismo puerto que HTTP)
```

### Handshake de conexión

El cliente debe enviar en `auth`:

```json
{
  "token": "<JWT>",
  "id": "<UUID del usuario>",
  "serverOffset": 0
}
```

| Campo | Tipo | Requerido | Descripción |
|---|---|---|---|
| `token` | string | No* | JWT del usuario. Si es válido, se extrae el `userKey`. |
| `id` | string (UUID) | No* | Fallback: UUID del usuario si no hay token o falla. |
| `serverOffset` | integer | No | ID del último mensaje recibido (para sincronización). |

\* Al menos uno de `token` o `id` debe estar presente.

### CORS

```
origin: [FRONTEND_ORIGIN]
methods: ["GET", "POST"]
credentials: true
```

### Connection State Recovery

El servidor soporta recuperación de conexión con:
- `maxDisconnectionDuration`: 2 minutos
- `maxDisconnectionDelay`: 5 segundos

---

## Eventos del cliente → Servidor

### `setUserId`

Asigna el ID del usuario al socket y lo une a su sala personal.

**Payload:**

```json
"uuid-del-usuario"
```

(string, no objeto)

**Efecto:** El socket se une a la sala `user:<uuid>`.

---

### `join_group`

Une al socket a un chat grupal y envía el historial de mensajes.

**Payload (objeto):**

```json
{
  "chatId": 3,
  "serverOffset": 0
}
```

| Campo | Tipo | Descripción |
|---|---|---|
| `chatId` | integer | ID del chat al que unirse |
| `serverOffset` | integer | ID del último mensaje recibido (0 para obtener los últimos 50) |

**Payload (número directo, legacy):**

```json
3
```

(integer — equivalente a `{ chatId: 3, serverOffset: 0 }`)

**Validaciones:**
- El usuario debe ser participante del chat.
- El chat debe existir.

**Efectos:**
1. El socket se une a la sala `chat:<chatId>`.
2. Se emite `join_group` con el nombre de la sala.
3. Se emite `chat_message` por cada mensaje del historial.
4. Se marcan como leídos los mensajes no enviados por el usuario.

---

### `join_chat`

Evento versátil que maneja múltiples escenarios:

**Escenario 1 — Unirse a un chat por ID numérico:**

```json
3
```

Si el usuario es participante, se une al chat. Si no, y es un grupo, emite error.

**Escenario 2 — Objeto con chatId:**

```json
{
  "chatId": 3,
  "serverOffset": 0
}
```

Equivalente a `join_group` pero también emite `join_chat`.

**Escenario 3 — Iniciar/abrir chat directo con otro usuario:**

```json
"uuid-del-otro-usuario"
```

(string UUID — no numérico)

**Efectos del escenario 3:**
1. Se une a la sala con nombre generado por `createNameChatRooms(userKey, peerKey)`.
2. Se emite `join_chat` con el nombre de la sala.
3. Se crea o recupera el chat directo entre los dos usuarios.
4. Se une a la sala `chat:<chatId>`.
5. Se emite `chat_message` por cada mensaje del historial.
6. Se marcan los mensajes como leídos.

---

### `chat_message`

Envía un mensaje a un chat.

**Payload — Mensaje a chat grupal:**

```json
{
  "chatId": 3,
  "message": "Hola grupo"
}
```

**Payload — Mensaje directo a un usuario:**

```json
{
  "send_to": "uuid-del-destinatario",
  "message": "Hola"
}
```

**Payload — Mensaje a un chat por ID (en send_to):**

```json
{
  "send_to": "3",
  "message": "Hola"
}
```

Si `send_to` es numérico y el usuario es participante, se trata como chat grupal.

| Campo | Tipo | Descripción |
|---|---|---|
| `message` | string | Contenido del mensaje (requerido) |
| `chatId` | integer | ID del chat grupal (modo grupo) |
| `send_to` | string \| integer | UUID del destinatario (directo) o ID de chat (grupal) |

**Acknowledgment (callback):**

Si el cliente pasa un callback de acknowledgment:

```javascript
socket.emit("chat_message", data, (ack) => {
  // ack = { status: "ok", serverOffset: "123" }
  // o
  // ack = { status: "error", message: "Mensaje vacío" }
});
```

**Efectos:**
1. Guarda el mensaje en la base de datos.
2. Actualiza `last_message_content`, `last_message_at` y `last_message_sender_id` del chat.
3. Emite `chat_message` al remitente.
4. Emite `chat_message` a todos los destinatarios (vía sala `user:<uuid>`).
5. Emite `receiveNotification` a los destinatarios.
6. Llama al acknowledgment con el resultado.

---

## Eventos del servidor → Cliente

### `chat_message`

Mensaje nuevo o del historial.

**Payload:**

```json
{
  "message": "Hola mundo",
  "serverOffset": "123",
  "send_to": "uuid-del-destinatario",
  "send_by": "uuid-del-remitente",
  "sender_name": "Nombre descifrado",
  "created_at": "2026-06-29T10:00:00.000Z",
  "chatId": 3
}
```

| Campo | Tipo | Descripción |
|---|---|---|
| `message` | string | Contenido del mensaje |
| `serverOffset` | string | ID del mensaje (para sincronización) |
| `send_to` | string \| null | UUID del destinatario (en chats directos) o `null` (en grupos) |
| `send_by` | string (UUID) | UUID del remitente |
| `sender_name` | string \| null | Nombre descifrado del remitente (del JWT) |
| `created_at` | string (ISO 8601) | Fecha de creación |
| `chatId` | integer | ID del chat |

---

### `receiveNotification`

Notificación de mensaje no leído.

**Payload — Notificación de grupo:**

```json
{
  "sender": "uuid-del-remitente",
  "chatId": 3,
  "sender_name": "Nombre descifrado",
  "content": "Hola grupo"
}
```

**Payload — Notificación directa:**

```json
{
  "sender": "uuid-del-remitente",
  "senderName": "Nombre descifrado",
  "chatId": 5,
  "content": "Hola"
}
```

**Payload — Notificación de mensajes pendientes al conectar:**

```json
{
  "sender": "uuid-del-remitente",
  "chatId": 3,
  "content": "Mensaje pendiente",
  "pending": true,
  "serverOffset": 42
}
```

---

### `join_group`

Confirmación de unión a un chat grupal.

**Payload:**

```json
{
  "room": "chat:3",
  "otherUser": null
}
```

---

### `join_chat`

Confirmación de unión a un chat (evento legacy compatible).

**Payload:**

```json
{
  "room": "chat:3",
  "otherUser": null
}
```

---

### `chat_error`

Error en operaciones de chat.

**Payload:**

```json
{
  "message": "No eres participante de este chat"
}
```

---

### `auth`

Confirmación de autenticación WebSocket exitosa.

**Payload:** `"Autenticación exitosa"` (string)

---

### `error`

Error de autenticación WebSocket.

**Payload:** `"No se proporcionó un token de acceso válido"` (string)

---

## Salas (rooms)

El servidor gestiona las siguientes salas:

| Sala | Descripción |
|---|---|
| `user:<uuid>` | Sala personal del usuario. Se usa para enviar notificaciones y mensajes directos. |
| `chat:<chatId>` | Sala de un chat específico. Se usa para mensajes grupales. |
| `<uuidA>_<uuidB>` | Sala de chat directo entre dos usuarios (nombre generado ordenando los UUIDs alfabéticamente). |

### Generación de nombres de salas directas

**Archivo:** `utils/sockets.js`

```javascript
function createNameChatRooms(sender, receiver) {
  if (sender < receiver) {
    return sender + "_" + receiver;
  } else {
    return receiver + "_" + sender;
  }
}
```

Los UUIDs se ordenan alfabéticamente para que ambos interlocutores generen el mismo nombre de sala.

---

## Mensajes pendientes al conectar

Cuando un usuario se conecta, el servidor busca los últimos mensajes no leídos (máximo 20) donde el usuario es participante pero no es el remitente, y emite `receiveNotification` por cada uno.
