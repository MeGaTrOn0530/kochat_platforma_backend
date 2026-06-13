export function sendOk(res, data, message) {
  const payload = { success: true };

  if (message) {
    payload.message = message;
  }

  if (data !== undefined) {
    payload.data = data;
  }

  return res.json(payload);
}

export function sendCreated(res, data, message) {
  const payload = { success: true };

  if (message) {
    payload.message = message;
  }

  if (data !== undefined) {
    payload.data = data;
  }

  return res.status(201).json(payload);
}
