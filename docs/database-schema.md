# Esquema de base de datos

Gestionado con **Prisma ORM** sobre **MySQL**.

**Archivo:** `prisma/schema.prisma`

---

## Tabla `chats`

Almacena tanto chats individuales como grupales.

| Columna                  | Tipo MySQL         | Nullable | Default             | Descripción                                                     |
| ------------------------ | ------------------ | -------- | ------------------- | --------------------------------------------------------------- |
| `id`                     | INT AUTO_INCREMENT | No       | —                   | Clave primaria                                                  |
| `is_group`               | BOOLEAN            | No       | `false`             | `false` = individual, `true` = grupal                           |
| `chat_type`              | VARCHAR(20)        | No       | `'DIRECT'`          | Tipo de chat: `DIRECT`, `TRAYECTO`, `VIAJE`, `EVENT`            |
| `name`                   | VARCHAR(255)       | Sí       | `NULL`              | Nombre del grupo (solo si `is_group = true`)                    |
| `trip_id`                | CHAR(36)           | Sí       | `NULL`              | UUID del trayecto/viaje/evento asociado (microservicio externo) |
| `admin_id`               | CHAR(36)           | Sí       | `NULL`              | UUID del admin del grupo (microservicio externo)                |
| `last_message_content`   | TEXT               | Sí       | `NULL`              | Contenido del último mensaje (optimización inbox)               |
| `last_message_at`        | DATETIME           | Sí       | `NULL`              | Fecha del último mensaje                                        |
| `last_message_sender_id` | CHAR(36)           | Sí       | `NULL`              | UUID del remitente del último mensaje                           |
| `created_at`             | DATETIME           | No       | `CURRENT_TIMESTAMP` | Fecha de creación                                               |

### Índices

| Índice                        | Columnas                                | Propósito                          |
| ----------------------------- | --------------------------------------- | ---------------------------------- |
| `idx_chats_trip_id`           | `trip_id`                               | Búsqueda por trayecto/viaje/evento |
| `idx_chats_chat_type_trip_id` | `chat_type, trip_id`                    | Búsqueda por tipo + entidad        |
| `idx_chats_admin_id`          | `admin_id`                              | Búsqueda por admin                 |
| `idx_chats_last_message_at`   | `last_message_at`                       | Ordenar inbox por reciente         |
| `idx_chats_group_inbox`       | `is_group, last_message_at, created_at` | Listar chats grupales ordenados    |

### Relaciones

- `messages` → array de `Message` (one-to-many, cascade delete)
- `participants` → array de `ChatParticipant` (one-to-many, cascade delete)

---

## Tabla `messages`

Mensajes de los chats (individuales y grupales).

| Columna      | Tipo MySQL         | Nullable | Default             | Descripción                                 |
| ------------ | ------------------ | -------- | ------------------- | ------------------------------------------- |
| `id`         | INT AUTO_INCREMENT | No       | —                   | Clave primaria                              |
| `chat_id`    | INT                | No       | —                   | FK → `chats.id` (ON DELETE CASCADE)         |
| `sender_id`  | CHAR(36)           | No       | —                   | UUID del remitente (microservicio externo)  |
| `content`    | TEXT               | No       | —                   | Contenido del mensaje                       |
| `type`       | VARCHAR(20)        | No       | `'TEXT'`            | Tipo de mensaje (`TEXT`, `IMAGE`, `SYSTEM`) |
| `is_read`    | BOOLEAN            | No       | `false`             | Si el mensaje ha sido leído                 |
| `created_at` | DATETIME           | No       | `CURRENT_TIMESTAMP` | Fecha de creación                           |

### Índices

| Índice                            | Columnas               | Propósito                            |
| --------------------------------- | ---------------------- | ------------------------------------ |
| `idx_messages_chat_id_id`         | `chat_id, id`          | Listar mensajes de un chat ordenados |
| `idx_messages_chat_id_is_read_id` | `chat_id, is_read, id` | Buscar mensajes no leídos            |
| `idx_messages_created_at`         | `created_at`           | Ordenar por fecha                    |

### Relaciones

- `chat` → `Chat` (many-to-one, `chat_id` → `chats.id`, ON DELETE CASCADE)

---

## Tabla `chat_participants`

Relación N:M entre chats y usuarios.

| Columna     | Tipo MySQL | Nullable | Default             | Descripción                              |
| ----------- | ---------- | -------- | ------------------- | ---------------------------------------- |
| `chat_id`   | INT        | No       | —                   | FK → `chats.id` (ON DELETE CASCADE)      |
| `user_id`   | CHAR(36)   | No       | —                   | UUID del usuario (microservicio externo) |
| `joined_at` | DATETIME   | No       | `CURRENT_TIMESTAMP` | Fecha de unión al chat                   |

### Clave primaria

Compuesta: `(chat_id, user_id)` — evita duplicados.

### Índices

| Índice                                  | Columnas           | Propósito                  |
| --------------------------------------- | ------------------ | -------------------------- |
| `idx_chat_participants_user_id_chat_id` | `user_id, chat_id` | Buscar chats de un usuario |

### Relaciones

- `chat` → `Chat` (many-to-one, `chat_id` → `chats.id`, ON DELETE CASCADE)

---

## Notas de diseño

### IDs de usuario como UUIDs (CHAR(36))

Al ser un microservicio, los IDs de usuario no son foreign keys a una tabla local. Se almacenan como `CHAR(36)` (UUID) y se referencian a otro microservicio. Lo mismo aplica a `trip_id`.

### Sin tabla `users` ni `pre_register`

Este microservicio no gestiona usuarios ni pre-registros. Esas tablas pertenecen al microservicio de usuarios. Las consultas a `users` que existían previamente han sido eliminadas del código.

### `chat_id` como INT autoincrement

El ID interno de los chats es un entero autoincremental, no un UUID. Esto es porque los chats son entidades propias de este microservicio.

### `chat_type` para diferenciar entidades

La columna `chat_type` permite distinguir chats de trayectos, viajes o eventos usando el mismo `trip_id` (UUID genérico):

- `DIRECT` — Chat individual entre dos usuarios
- `TRAYECTO` — Chat grupal de un trayecto
- `VIAJE` — Chat grupal de un viaje
- `EVENT` — Chat grupal de un evento

### Wrapper de compatibilidad

**Archivo:** `app/database.js`

El código existente usa `db.execute({ sql, args })` (interfaz de `@libsql/client`). El wrapper mantiene esta interfaz usando `prisma.$queryRawUnsafe` y `prisma.$executeRawUnsafe` internamente, devolviendo `{ rows, lastInsertRowid, changes }`.

### Comandos de Prisma

```bash
# Sincronizar schema con la base de datos
npx prisma db push

# Regenerar el cliente de Prisma
npx prisma generate

# Abrir Prisma Studio (GUI de la BD)
npx prisma studio
```
