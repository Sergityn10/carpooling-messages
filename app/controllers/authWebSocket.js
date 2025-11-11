import dotenv from "dotenv";
dotenv.config();
const USUARIOS_URL = process.env.USUARIOS_URL;
async function authenticate(socket) {
    const token = socket.handshake.auth.token;
    if (!token) {
        return socket.emit("error", "No se proporcionó un token de acceso");
    }

    // 2. Construir el header 'Cookie'
    const cookieHeaderValue = `access_token=${token}`; // El formato debe ser 'nombre=valor'

    fetch(`${USUARIOS_URL}/api/auth/validate`, {
        method: "GET",
        // 'credentials: "include"' le dice a fetch que envíe cookies/headers de autenticación
        credentials: "include", 
        
        // 🔑 AÑADIR HEADERS: Aquí es donde incluyes el header 'Cookie' manualmente
        headers: {
            'Cookie': cookieHeaderValue
        }
        
    })
    .then(async response => {
        if (!response.ok) {
            const body = await response.json()
            throw new Error(`${body.message}`);
        }
        return response.json();
    })
    .then(data => {
        socket.user = data.data;
        socket.emit("auth", "Autenticación exitosa");
    })
    .catch(error => {
        console.error("Error al validar el token:", error);
        return socket.emit("error", "No se proporcionó un token de acceso válido");
    });
}

export const utilsAuthentication = {
    authenticate
}