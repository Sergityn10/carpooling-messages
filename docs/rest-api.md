# API REST

Base URL: `http://localhost:4002`

Todos los endpoints requieren autenticación (ver [Autenticación](./authentication.md)).

---

## Chats

### Listar todos mis chats (individuales + grupales)

```
GET /api/chats
```

Lista todos los chats (individuales y grupales) en los que el usuario autenticado es participante, ordenados por el mensaje más reciente.

**Respuesta `200`:**

```json
[
  {
    "send_by": "uuid-del-usuario",
    "send_to": "uuid-del-otro-usuario",
    "chat_id": 1,
    "is_group": 0,
    "lastMessage": {
      "message": "Último mensaje",
      "send_by": "uuid-del-remitente",
      "created_at": "2026-06-29T10:00:00.000Z"
    }
  },
  {
    "chat_id": 2,
    "is_group": 1,
    "name": "Viaje a Madrid",
    "trip_id": "uuid-del-trayecto",
    "admin_id": "uuid-del-admin",
    "lastMessage": {
      "message": "Último mensaje del grupo",
      "send_by": "uuid-del-remitente",
      "created_at": "2026-06-29T10:00:00.000Z"
    }
  }
]
```

---

### Listar chats de un usuario específico

```
GET /api/chats/user/:userKey
```

| Parámetro | Tipo          | Descripción    |
| --------- | ------------- | -------------- |
| `userKey` | UUID (string) | ID del usuario |

**Respuesta `200`:** Igual que `GET /api/chats` pero para el usuario especificado.

---

### Listar mis chats grupales

```
GET /api/chats/me
```

Lista solo los chats grupales del usuario autenticado.

**Respuesta `200`:**

```json
[
  {
    "id": 2,
    "is_group": 1,
    "name": "Viaje a Madrid",
    "trip_id": "uuid-del-trayecto",
    "admin_id": "uuid-del-admin",
    "last_message_content": "Hola",
    "last_message_at": "2026-06-29T10:00:00.000Z",
    "last_message_sender_id": "uuid-del-remitente",
    "created_at": "2026-06-29T09:00:00.000Z"
  }
]
```

---

### Listar chats grupales de un usuario específico

```
GET /api/chats/user/:userKey/groups
```

| Parámetro | Tipo          | Descripción    |
| --------- | ------------- | -------------- |
| `userKey` | UUID (string) | ID del usuario |

**Respuesta `200`:** Array de chats grupales (mismo formato que `GET /api/chats/me`).

---

### Obtener chat grupal por ID

```
GET /api/chats/:chatId
```

| Parámetro | Tipo    | Descripción |
| --------- | ------- | ----------- |
| `chatId`  | integer | ID del chat |

**Respuesta `200`:**

```json
{
  "chat": {
    "id": 2,
    "is_group": 1,
    "name": "Viaje a Madrid",
    "trip_id": "uuid-del-trayecto",
    "admin_id": "uuid-del-admin",
    "last_message_content": "Hola",
    "last_message_at": "2026-06-29T10:00:00.000Z",
    "last_message_sender_id": "uuid-del-remitente",
    "created_at": "2026-06-29T09:00:00.000Z"
  },
  "participants": [
    { "user_id": "uuid-1", "joined_at": "2026-06-29T09:00:00.000Z" },
    { "user_id": "uuid-2", "joined_at": "2026-06-29T09:05:00.000Z" }
  ]
}
```

**Errores:**

| Status | Causa              |
| ------ | ------------------ |
| `400`  | `chatId` inválido  |
| `404`  | Chat no encontrado |

---

### Obtener chat grupal por trip_id

```
GET /api/chats/trip/:tripId?type=TRAYECTO
```

| Parámetro | Tipo          | Descripción                  |
| --------- | ------------- | ---------------------------- |
| `tripId`  | UUID (string) | ID del trayecto/viaje/evento |

**Query params opcionales:**

| Param  | Tipo   | Default    | Descripción                                |
| ------ | ------ | ---------- | ------------------------------------------ |
| `type` | string | `TRAYECTO` | Tipo de chat: `TRAYECTO`, `VIAJE`, `EVENT` |

**Respuesta `200`:** Igual que `GET /api/chats/:chatId`.

**Errores:**

| Status | Causa                      |
| ------ | -------------------------- |
| `400`  | `tripId` o `type` inválido |
| `404`  | Chat no encontrado         |

---

### Desactivar chats por trip_id

```
PATCH /api/chats/trip/:tripId/disable?type=TRAYECTO
```

Desactiva todos los chats asociados a un `trip_id` estableciendo `status = "INACTIVE"`. Pensado para ser llamado cuando un trayecto/viaje/evento finaliza o se cancela.

| Parámetro | Tipo          | Descripción                  |
| --------- | ------------- | ---------------------------- |
| `tripId`  | UUID (string) | ID del trayecto/viaje/evento |

**Query params opcionales:**

| Param  | Tipo   | Default | Descripción                                              |
| ------ | ------ | ------- | -------------------------------------------------------- |
| `type` | string | `ALL`   | Filtrar por tipo: `TRAYECTO`, `VIAJE`, `EVENT`. Si se omite, desactiva todos los tipos. |

**Respuesta `200`:**

```json
{
  "success": true,
  "disabledCount": 1,
  "trip_id": "uuid-del-trayecto",
  "chat_type": "TRAYECTO"
}
```

| Campo           | Tipo    | Descripción                                    |
| --------------- | ------- | ---------------------------------------------- |
| `success`       | boolean | `true` si la operación fue exitosa             |
| `disabledCount` | number  | Número de chats desactivados                   |
| `trip_id`       | string  | UUID del trayecto/viaje/evento                 |
| `chat_type`     | string  | Tipo filtrado o `ALL` si no se especificó      |

**Errores:**

| Status | Causa                                         |
| ------ | --------------------------------------------- |
| `400`  | `tripId` inválido o `type` no válido          |
| `404`  | No se encontraron chats para ese `trip_id`    |

---

### Crear chat grupal

```
POST /api/chats
```

**Body (JSON):**

```json
{
  "name": "Viaje a Madrid",
  "chat_type": "TRAYECTO",
  "trip_id": "uuid-del-trayecto",
  "admin_id": "uuid-del-admin",
  "participant_ids": ["uuid-1", "uuid-2", "uuid-3"]
}
```

| Campo             | Tipo          | Requerido | Descripción                                          |
| ----------------- | ------------- | --------- | ---------------------------------------------------- |
| `name`            | string        | No        | Nombre del grupo                                     |
| `chat_type`       | string        | No        | Tipo de chat: `TRAYECTO` (default), `VIAJE`, `EVENT` |
| `trip_id`         | UUID (string) | No        | ID del trayecto/viaje/evento asociado                |
| `admin_id`        | UUID (string) | No        | ID del admin (por defecto: usuario autenticado)      |
| `participant_ids` | UUID[]        | No        | Lista de participantes a añadir                      |

**Respuesta `201`:**

```json
{
  "chat": {
    "id": 3,
    "is_group": 1,
    "name": "Viaje a Madrid",
    "trip_id": "uuid-del-trayecto",
    "admin_id": "uuid-del-admin",
    "last_message_content": null,
    "last_message_at": null,
    "last_message_sender_id": null,
    "created_at": "2026-06-29T10:00:00.000Z"
  }
}
```

**Errores:**

| Status | Causa                                         |
| ------ | --------------------------------------------- |
| `400`  | Validación Zod fallida o `admin_id` requerido |
| `500`  | Error interno                                 |

---

### Actualizar chat grupal

```
PATCH /api/chats/:chatId
```

| Parámetro | Tipo    | Descripción |
| --------- | ------- | ----------- |
| `chatId`  | integer | ID del chat |

**Body (JSON) — al menos un campo:**

```json
{
  "name": "Nuevo nombre",
  "chat_type": "VIAJE",
  "trip_id": "uuid-nuevo-trayecto",
  "admin_id": "uuid-nuevo-admin"
}
```

| Campo       | Tipo                  | Descripción                                       |
| ----------- | --------------------- | ------------------------------------------------- |
| `name`      | string                | Nuevo nombre del grupo                            |
| `chat_type` | string                | Nuevo tipo de chat (`TRAYECTO`, `VIAJE`, `EVENT`) |
| `trip_id`   | UUID (string) \| null | Nuevo ID de trayecto/viaje/evento                 |
| `admin_id`  | UUID (string)         | Nuevo admin del grupo                             |

**Respuesta `200`:** `{ "chat": { ... } }`

**Errores:**

| Status | Causa                                             |
| ------ | ------------------------------------------------- |
| `400`  | `chatId` inválido o no hay campos para actualizar |
| `403`  | Solo el admin puede realizar esta acción          |
| `404`  | Chat no encontrado                                |

---

### Activar / desactivar un chat

```
PATCH /api/chats/:chatId/status
```

| Parámetro | Tipo    | Descripción |
| --------- | ------- | ----------- |
| `chatId`  | integer | ID del chat |

Cambia el estado del chat (`ACTIVE` / `INACTIVE`). Funciona tanto para chats grupales como individuales. En chats grupales solo el **admin** puede cambiar el estado; en chats directos, **cualquier participante**.

**Body (JSON):**

```json
{
  "status": "INACTIVE"
}
```

| Campo    | Tipo   | Requerido | Descripción           |
| -------- | ------ | --------- | --------------------- |
| `status` | string | Sí        | `ACTIVE` o `INACTIVE` |

**Respuesta `200`:**

```json
{
  "chat": {
    "id": 3,
    "is_group": true,
    "chat_type": "TRAYECTO",
    "status": "INACTIVE",
    "name": "Viaje a Madrid",
    "trip_id": "uuid-del-trayecto",
    "admin_id": "uuid-del-admin",
    "created_at": "2026-06-29T10:00:00.000Z"
  }
}
```

**Errores:**

| Status | Causa                                                  |
| ------ | ------------------------------------------------------ |
| `400`  | `chatId` inválido o `status` no es `ACTIVE`/`INACTIVE` |
| `403`  | No eres participante, o no eres el admin (chat grupal) |
| `404`  | Chat no encontrado                                     |

---

### Eliminar chat grupal

```
DELETE /api/chats/:chatId
```

| Parámetro | Tipo    | Descripción |
| --------- | ------- | ----------- |
| `chatId`  | integer | ID del chat |

**Respuesta `204`:** Sin contenido.

**Errores:**

| Status | Causa                                |
| ------ | ------------------------------------ |
| `400`  | `chatId` inválido                    |
| `403`  | Solo el admin puede eliminar el chat |
| `404`  | Chat no encontrado                   |

---

## Participantes

### Listar participantes de un chat

```
GET /api/chats/:chatId/participants
```

| Parámetro | Tipo    | Descripción |
| --------- | ------- | ----------- |
| `chatId`  | integer | ID del chat |

**Respuesta `200`:**

```json
[
  { "user_id": "uuid-1", "joined_at": "2026-06-29T09:00:00.000Z" },
  { "user_id": "uuid-2", "joined_at": "2026-06-29T09:05:00.000Z" }
]
```

---

### Añadir participante a un chat grupal

```
POST /api/chats/:chatId/participants
```

| Parámetro | Tipo    | Descripción |
| --------- | ------- | ----------- |
| `chatId`  | integer | ID del chat |

**Body (JSON):**

```json
{
  "user_id": "uuid-del-usuario"
}
```

| Campo     | Tipo          | Requerido | Descripción             |
| --------- | ------------- | --------- | ----------------------- |
| `user_id` | UUID (string) | Sí        | ID del usuario a añadir |

**Respuesta `201`:**

```json
{
  "chat_id": 3,
  "user_id": "uuid-del-usuario"
}
```

**Errores:**

| Status | Causa                                    |
| ------ | ---------------------------------------- |
| `400`  | `chatId` inválido o validación fallida   |
| `403`  | Solo el admin puede añadir participantes |
| `404`  | Chat no encontrado                       |
| `409`  | El usuario ya es participante            |

---

### Eliminar participante de un chat grupal

```
DELETE /api/chats/:chatId/participants/:userKey
```

| Parámetro | Tipo          | Descripción               |
| --------- | ------------- | ------------------------- |
| `chatId`  | integer       | ID del chat               |
| `userKey` | UUID (string) | ID del usuario a eliminar |

**Respuesta `204`:** Sin contenido.

**Errores:**

| Status | Causa                                      |
| ------ | ------------------------------------------ |
| `400`  | Parámetros inválidos                       |
| `403`  | Solo el admin puede eliminar participantes |
| `404`  | Chat no encontrado                         |

---

## Unirse / Salirse de un grupo

### Unirse a un chat grupal

```
POST /api/chats/:chatId/join
```

| Parámetro | Tipo    | Descripción |
| --------- | ------- | ----------- |
| `chatId`  | integer | ID del chat |

El usuario autenticado se añade como participante.

**Respuesta `201`:**

```json
{
  "chat_id": 3,
  "user_id": "uuid-del-usuario"
}
```

**Errores:**

| Status | Causa                |
| ------ | -------------------- |
| `400`  | `chatId` inválido    |
| `404`  | Chat no encontrado   |
| `409`  | Ya eres participante |

---

### Salirse de un chat grupal

```
POST /api/chats/:chatId/leave
```

| Parámetro | Tipo    | Descripción |
| --------- | ------- | ----------- |
| `chatId`  | integer | ID del chat |

El usuario autenticado abandona el chat.

**Respuesta `204`:** Sin contenido.

**Errores:**

| Status | Causa                                                        |
| ------ | ------------------------------------------------------------ |
| `400`  | `chatId` inválido                                            |
| `403`  | El admin no puede salir (debe transferir o eliminar el chat) |
| `404`  | Chat no encontrado                                           |

---

## Mensajes

### Listar mensajes de un chat

```
GET /api/chats/:chatId/messages
```

| Parámetro | Tipo    | Descripción |
| --------- | ------- | ----------- |
| `chatId`  | integer | ID del chat |

**Query params opcionales:**

| Param       | Tipo    | Default | Descripción                                        |
| ----------- | ------- | ------- | -------------------------------------------------- |
| `limit`     | integer | 50      | Máximo de mensajes (1-200)                         |
| `before_id` | integer | —       | Obtener mensajes anteriores a este ID (paginación) |

**Respuesta `200`:**

```json
[
  {
    "id": 1,
    "chat_id": 3,
    "sender_id": "uuid-del-remitente",
    "content": "Hola",
    "type": "TEXT",
    "is_read": 1,
    "created_at": "2026-06-29T10:00:00.000Z"
  }
]
```

Los mensajes se devuelven en orden ascendente (del más antiguo al más reciente).

---

### Crear mensaje en un chat

```
POST /api/chats/:chatId/messages
```

| Parámetro | Tipo    | Descripción |
| --------- | ------- | ----------- |
| `chatId`  | integer | ID del chat |

**Body (JSON):**

```json
{
  "content": "Hola mundo",
  "type": "TEXT"
}
```

| Campo     | Tipo   | Requerido | Descripción                             |
| --------- | ------ | --------- | --------------------------------------- |
| `content` | string | Sí        | Contenido del mensaje (mín. 1 carácter) |
| `type`    | string | No        | Tipo de mensaje (default: `"TEXT"`)     |

**Respuesta `201`:**

```json
{
  "id": 5,
  "chat_id": 3,
  "sender_id": "uuid-del-remitente",
  "content": "Hola mundo",
  "type": "TEXT",
  "is_read": 0,
  "created_at": "2026-06-29T10:00:00.000Z"
}
```

---

### Editar mensaje

```
PATCH /api/chats/:chatId/messages/:messageId
```

| Parámetro   | Tipo    | Descripción    |
| ----------- | ------- | -------------- |
| `chatId`    | integer | ID del chat    |
| `messageId` | integer | ID del mensaje |

**Body (JSON):**

```json
{
  "content": "Mensaje editado"
}
```

| Campo     | Tipo   | Requerido | Descripción                       |
| --------- | ------ | --------- | --------------------------------- |
| `content` | string | Sí        | Nuevo contenido (mín. 1 carácter) |

**Respuesta `200`:**

```json
{
  "id": 5,
  "chat_id": 3,
  "content": "Mensaje editado"
}
```

**Errores:**

| Status | Causa                                                        |
| ------ | ------------------------------------------------------------ |
| `400`  | Parámetros inválidos                                         |
| `403`  | No puedes editar este mensaje (solo el remitente o el admin) |
| `404`  | Mensaje no encontrado                                        |

---

### Eliminar mensaje

```
DELETE /api/chats/:chatId/messages/:messageId
```

| Parámetro   | Tipo    | Descripción    |
| ----------- | ------- | -------------- |
| `chatId`    | integer | ID del chat    |
| `messageId` | integer | ID del mensaje |

**Respuesta `204`:** Sin contenido.

**Errores:**

| Status | Causa                                                          |
| ------ | -------------------------------------------------------------- |
| `400`  | Parámetros inválidos                                           |
| `403`  | No puedes eliminar este mensaje (solo el remitente o el admin) |
| `404`  | Mensaje no encontrado                                          |

---

## Chats de eventos

Los chats de eventos usan `chat_type = "EVENT"` y se asocian a un evento mediante `trip_id` (UUID genérico del evento). El flujo de vida es:

### 1. Crear chat de evento

```
POST /api/chats
```

**Body:**

```json
{
  "name": "Evento Madrid 2026",
  "chat_type": "EVENT",
  "trip_id": "uuid-del-evento",
  "participant_ids": ["uuid-1", "uuid-2", "uuid-3"]
}
```

Por defecto, el `admin_id` es el usuario autenticado. El chat se crea con `status = "ACTIVE"`.

**Respuesta `201`:**

```json
{
  "chat": {
    "id": 5,
    "is_group": true,
    "chat_type": "EVENT",
    "status": "ACTIVE",
    "name": "Evento Madrid 2026",
    "trip_id": "uuid-del-evento",
    "admin_id": "uuid-del-admin",
    "created_at": "2026-09-08T10:00:00.000Z"
  }
}
```

### 2. Obtener chat de evento

```
GET /api/chats/trip/:tripId?type=EVENT
```

Devuelve el chat grupal asociado al evento. Requiere ser participante del chat.

**Ejemplo:**

```bash
curl http://localhost:4002/api/chats/trip/5504c3ee-3e09-4aa6-a46a-546cad1ccdd3?type=EVENT \
  -H "Authorization: Bearer <JWT>"
```

### 3. Añadir participantes al evento

```
POST /api/chats/:chatId/participants
```

**Body:**

```json
{
  "user_id": "uuid-del-nuevo-participante"
}
```

Solo el admin del chat puede añadir participantes.

### 4. Desactivar chat cuando el evento finaliza

```
PATCH /api/chats/trip/:tripId/disable?type=EVENT
```

Desactiva el chat del evento poniendo `status = "INACTIVE"`. Pensado para llamarse desde el microservicio de eventos cuando un evento termina.

**Ejemplo:**

```bash
curl -X PATCH http://localhost:4002/api/chats/trip/5504c3ee-3e09-4aa6-a46a-546cad1ccdd3/disable?type=EVENT \
  -H "Authorization: Bearer <JWT>"
```

**Respuesta `200`:**

```json
{
  "success": true,
  "disabledCount": 1,
  "trip_id": "5504c3ee-3e09-4aa6-a46a-546cad1ccdd3",
  "chat_type": "EVENT"
}
```

### 5. Reactivar chat (si el evento se reactiva)

```
PATCH /api/chats/:chatId/status
```

**Body:**

```json
{
  "status": "ACTIVE"
}
```

### Resumen del flujo

```
Crear evento → POST /api/chats (chat_type=EVENT)
   ↓
Obtener chat   → GET /api/chats/trip/:tripId?type=EVENT
   ↓
Añadir users   → POST /api/chats/:chatId/participants
   ↓
Evento termina → PATCH /api/chats/trip/:tripId/disable?type=EVENT
   ↓
Reactivar      → PATCH /api/chats/:chatId/status { status: ACTIVE }
```

> **Nota:** Los chats de eventos funcionan igual que los de trayectos o viajes. La única diferencia es el valor de `chat_type`. Todos los endpoints de participantes, mensajes y WebSocket aplican igual.

---

## Endpoint raíz

### Página principal

```
GET /
```

Devuelve el archivo `public/main.html` (interfaz de prueba estática).
