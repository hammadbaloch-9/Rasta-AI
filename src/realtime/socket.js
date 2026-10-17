import { logger } from '../utils/logger.js';
import { API_VERSION, ENGINE_VERSION } from '../simulation/version.js';

/**
 * Socket.IO contract (documented in docs/API.md):
 *   client -> server : simulation:subscribe   { simulationId }
 *   server -> client : simulation:subscribed  { simulationId, room }
 *   server -> client : simulation:update      { simulationId, status, t, intersections, vehicles, signals, ... }
 *   server -> client : simulation:completed   { simulationId, status, metrics }
 *   server -> client : simulation:failed      { simulationId, error }
 */
export function initSocket(io) {
  io.on('connection', (socket) => {
    logger.debug('Socket connected', { socketId: socket.id });

    socket.emit('server:hello', {
      service: 'raasta-ai-backend',
      apiVersion: API_VERSION,
      engineVersion: ENGINE_VERSION,
      time: new Date().toISOString(),
    });

    const subscribe = (payload = {}) => {
      const simulationId = typeof payload === 'string' ? payload : payload.simulationId;
      if (!simulationId || typeof simulationId !== 'string') {
        socket.emit('simulation:error', { message: 'simulationId is required to subscribe' });
        return;
      }
      const room = `simulation:${simulationId}`;
      socket.join(room);
      socket.emit('simulation:subscribed', { simulationId, room });
    };

    socket.on('simulation:subscribe', subscribe);

    socket.on('simulation:unsubscribe', (payload = {}) => {
      const simulationId = typeof payload === 'string' ? payload : payload.simulationId;
      if (simulationId) socket.leave(`simulation:${simulationId}`);
    });

    socket.on('disconnect', (reason) => {
      logger.debug('Socket disconnected', { socketId: socket.id, reason });
    });
  });

  return io;
}

export default initSocket;
