import { randomUUID } from 'node:crypto';

export const requestId = (req, res, next) => {
  req.id = req.get('x-request-id') || randomUUID().slice(0, 8);
  res.setHeader('x-request-id', req.id);
  next();
};

export default requestId;
