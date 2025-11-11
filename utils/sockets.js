function createNameChatRooms(sender, receiver){
    //La regla va a ser que el usuario con la inicial menor siempre va a ser el primero
    if(sender < receiver){
        return sender + "_" + receiver;
    }else{
        return receiver + "_" + sender;
    }
}

export const utilsSockets = {
    createNameChatRooms
}