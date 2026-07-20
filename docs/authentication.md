# Autenticación

## Descripción general

El microservicio verifica los JWT **localmente** usando una clave pública RSA (algoritmo RS256). No realiza llamadas a otros microservicios para validar tokens.

## Token JWT

- **Algoritmo:** RS256 (RSA + SHA-256)
- **Clave pública:** Se obtiene de la variable de entorno `PUBLIC_KEY`
- **Formato del token:** JWT estándar (`header.payload.signature`)

### Claims esperados del token decodificado

El token debe contener al menos uno de los siguientes campos para identificar al usuario:

| Claim | Tipo | Descripción |
|---|---|---|
| `id` | string (UUID) | ID del usuario (preferido) |
| `user_id` | string (UUID) | ID del usuario (alternativo) |
| `userId` | string (UUID) | ID del usuario (alternativo) |
| `email` | string | Email del usuario (fallback) |
| `name` | string | Nombre cifrado del usuario (AES-256-CBC) |

## Autenticación HTTP (REST)

**Archivo:** `app/controllers/auth.js`

El middleware `authenticate` se aplica a todos los endpoints REST. Acepta el token de dos formas:

1. **Header Authorization (Bearer):**
   ```
   Authorization: Bearer <token>
   ```

2. **Cookie:**
   ```
   Cookie: access_token=<token>
   ```

### Respuestas de error

| Status | Cuerpo | Causa |
|---|---|---|
| `401` | `{ status: "Error", message: "No se proporcionó un token de acceso" }` | No hay token |
| `401` | `{ status: "Error", message: "No se proporcionó un token de acceso válido" }` | Token inválido o expirado |

### Flujo

1. Extrae el token del header `Authorization` o de la cookie `access_token`.
2. Verifica el JWT con la clave pública usando `crypto.createPublicKey()`.
3. Si es válido, asigna el payload decodificado a `req.user`.
4. Si no es válido, responde con `401`.

## Autenticación WebSocket

**Archivo:** `app/controllers/authWebSocket.js` y `app/index.js`

La autenticación de WebSocket es **opcional** (best-effort). Permite conexiones sin token usando un fallback de ID.

### Handshake

El cliente debe enviar en `socket.handshake.auth`:

```json
{
  "token": "<JWT>",
  "id": "<UUID del usuario>",
  "serverOffset": 0
}
```

- `token`: JWT del usuario (preferido). Si es válido, se decodifica y se extrae el `userKey`.
- `id`: UUID del usuario (fallback si no hay token o falla la verificación).
- `serverOffset`: Offset del último mensaje recibido (para recuperación).

### Flujo `authenticateSocketIfPossible`

1. Intenta verificar el `token` con la clave pública.
2. Si tiene éxito, extrae el `userKey` del payload y lo asigna a `socket.userKey`.
3. Si falla o no hay token, usa `socket.handshake.auth.id` como fallback.
4. El socket se conecta en cualquier caso (no se rechaza la conexión).

## Cifrado de campos

**Archivo:** `utils/crypto.js`

El nombre del usuario (`name`) viene cifrado en el JWT usando AES-256-CBC. El microservicio lo descifra con `decrypMethods.decrypt()` usando la clave `ENCRYPTION_KEY` del `.env`.

Formato del texto cifrado: `IV_hex:encrypted_hex`
