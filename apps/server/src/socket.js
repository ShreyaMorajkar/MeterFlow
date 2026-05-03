let ioRef;

export function setSocketServer(io) {
  ioRef = io;
}

export function emitUsage(userId, payload) {
  if (ioRef) {
    ioRef.to(`user:${userId}`).emit('usage:logged', payload);
  }
}
