CREATE TABLE chats (
    id INTEGER PRIMARY KEY AUTOINCREMENT,
    
    -- Control de Tipo de Chat
    is_group INTEGER DEFAULT 0, -- 0 = Individual, 1 = Grupo (SQLite no tiene Boolean puro)
    
    -- Datos del Grupo (Solo se llenan si is_group = 1)
    name TEXT,                  -- Ej: "Viaje a Madrid"
    trip_id INTEGER,            -- Relación con tu tabla de Viajes (Trips)
    admin_id INTEGER,           -- El ID del conductor (User) que administra el grupo
    
    -- Optimización para la lista de chats (Inbox)
    -- Guardamos aquí el último mensaje para no tener que buscarlo cada vez que cargas la lista
    last_message_content TEXT,
    last_message_at DATETIME,

    created_at DATETIME DEFAULT CURRENT_TIMESTAMP,
    
    -- Claves foráneas (Opcional, pero recomendado)
    FOREIGN KEY (trip_id) REFERENCES trips(id) ON DELETE SET NULL,
    FOREIGN KEY (admin_id) REFERENCES users(id)
);
--MYSQL
CREATE TABLE IF NOT EXISTS chats (
    id INT AUTO_INCREMENT PRIMARY KEY,
    
    -- Control de Tipo de Chat
    is_group TINYINT(1) DEFAULT 0, -- 0 = Individual, 1 = Grupo
    
    -- Datos del Grupo
    name VARCHAR(255) DEFAULT NULL,
    trip_id INT DEFAULT NULL,
    admin_id INT DEFAULT NULL,
    
    -- Optimización para la lista de chats (Inbox)
    last_message_content TEXT,
    last_message_at DATETIME DEFAULT NULL,

    created_at TIMESTAMP DEFAULT CURRENT_TIMESTAMP,
    
    -- Claves foráneas
    CONSTRAINT fk_chat_trip 
        FOREIGN KEY (trip_id) REFERENCES trayectos(id) 
        ON DELETE SET NULL 
        ON UPDATE CASCADE,
    CONSTRAINT fk_chat_admin 
        FOREIGN KEY (admin_id) REFERENCES users(id) 
        ON DELETE SET NULL 
        ON UPDATE CASCADE
) ENGINE=InnoDB;

-- Índice para cargar rápido los chats de un viaje o los administrados por alguien
CREATE INDEX idx_chats_trip ON chats(trip_id);
CREATE INDEX idx_chats_admin ON chats(admin_id);
-- Índice para ordenar la lista de chats por el más reciente
CREATE INDEX idx_chats_last_msg ON chats(last_message_at DESC);