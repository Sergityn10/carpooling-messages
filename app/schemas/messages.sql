
    -- CREATE TABLE IF NOT EXISTS messages (
    --     id INTEGER PRIMARY KEY AUTOINCREMENT,
    --     message TEXT NOT NULL,
    --     send_by TEXT NOT NULL,
    --     send_to TEXT NOT NULL,
    --     readed TINYINT DEFAULT 0,
    --     created_at TIMESTAMP DEFAULT CURRENT_TIMESTAMP
    -- )

CREATE TABLE messages (
    id INTEGER PRIMARY KEY AUTOINCREMENT,
    chat_id INTEGER NOT NULL,
    sender_id INTEGER NOT NULL, -- Quién lo envió
    
    content TEXT NOT NULL,
    type TEXT DEFAULT 'TEXT',   -- 'TEXT', 'IMAGE', 'SYSTEM'
    
    is_read INTEGER DEFAULT 0,  -- 0 = No leído, 1 = Leído
    created_at DATETIME DEFAULT CURRENT_TIMESTAMP,
    
    FOREIGN KEY (chat_id) REFERENCES chats(id) ON DELETE CASCADE,
    FOREIGN KEY (sender_id) REFERENCES users(id)
);

--MYSQL
CREATE TABLE IF NOT EXISTS messages (
    id INT AUTO_INCREMENT PRIMARY KEY,
    chat_id INT NOT NULL,
    sender_id INT NOT NULL,
    
    content TEXT NOT NULL,
    type ENUM('TEXT', 'IMAGE', 'SYSTEM') DEFAULT 'TEXT',
    
    is_read TINYINT(1) DEFAULT 0,
    created_at TIMESTAMP DEFAULT CURRENT_TIMESTAMP,
    
    -- Relaciones
    CONSTRAINT fk_msg_chat 
        FOREIGN KEY (chat_id) REFERENCES chats(id) 
        ON DELETE CASCADE ON UPDATE CASCADE,
    CONSTRAINT fk_msg_sender_user 
        FOREIGN KEY (sender_id) REFERENCES users(id) 
        ON DELETE RESTRICT ON UPDATE CASCADE
) ENGINE=InnoDB;

-- Índices para un rendimiento fluido del chat
CREATE INDEX idx_msg_chat_id ON messages(chat_id);
CREATE INDEX idx_msg_created_at ON messages(created_at);