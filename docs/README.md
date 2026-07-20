# Carpooling Messages API

Microservicio de mensajería para la plataforma Carpooling. Gestiona chats individuales y grupales, mensajes en tiempo real vía WebSocket, y notificaciones de mensajes no leídos.

## Tabla de contenidos

- [Autenticación](./authentication.md)
- [API REST](./rest-api.md)
- [Eventos WebSocket](./websocket-events.md)
- [Esquema de base de datos](./database-schema.md)

## Stack tecnológico

- **Runtime:** Node.js + Express
- **Tiempo real:** Socket.IO
- **Base de datos:** MySQL (gestionada con Prisma ORM)
- **Autenticación:** JWT (RS256) con verificación local mediante clave pública
- **Validación:** Zod
- **Cifrado:** AES-256-CBC para campos sensibles

## Variables de entorno

| Variable | Descripción | Ejemplo |
|---|---|---|
| `DATABASE_URL` | URL de conexión MySQL para Prisma | `mysql://user:pass@localhost:3306/db` |
| `PUBLIC_KEY` | Clave pública RSA para verificar JWT | `-----BEGIN PUBLIC KEY-----\n...` |
| `PORT` | Puerto del servidor | `4002` |
| `FRONTEND_ORIGIN` | URL del frontend (CORS) | `http://localhost:5173` |
| `TRAYECTOS_URL` | URL del microservicio de trayectos (CORS) | `http://localhost:4001` |
| `ENCRYPTION_KEY` | Clave AES-256 para cifrado de campos | `estaesmiclaveultrasecreta` |

## Arquitectura

```
carpooling-messages/
├── app/
│   ├── index.js              # Entry point, servidor HTTP + WebSocket
│   ├── database.js           # Wrapper de Prisma con interfaz compatible
│   ├── controllers/
│   │   ├── auth.js           # Middleware de autenticación HTTP
│   │   ├── authWebSocket.js  # Autenticación WebSocket
│   │   └── chats.js          # Controladores REST de chats y mensajes
│   └── schemas/              # Esquemas SQL legacy (referencia)
├── prisma/
│   └── schema.prisma         # Esquema de base de datos Prisma
├── utils/
│   ├── jwtVerify.js          # Verificación de JWT con clave pública
│   ├── crypto.js             # Cifrado/descifrado AES-256-CBC
│   └── sockets.js            # Utilidades para nombres de salas
└── docs/                     # Esta documentación
```

## Inicio rápido

```bash
npm install
npx prisma db push
npm run dev
```
