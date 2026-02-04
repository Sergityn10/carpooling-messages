CREATE TABLE chat_participants (
    chat_id INTEGER NOT NULL,
    user_id INTEGER NOT NULL,
    
    joined_at DATETIME DEFAULT CURRENT_TIMESTAMP,
    
    PRIMARY KEY (chat_id, user_id), -- Evita que un usuario esté duplicado en el mismo chat
    FOREIGN KEY (chat_id) REFERENCES chats(id) ON DELETE CASCADE,
    FOREIGN KEY (user_id) REFERENCES users(id) ON DELETE CASCADE
);