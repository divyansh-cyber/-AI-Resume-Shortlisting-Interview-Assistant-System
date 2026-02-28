import multer, { FileFilterCallback } from 'multer';
import { Request } from 'express';
import path from 'path';
import fs from 'fs';
import { ValidationError } from '../../utils/errors';

const UPLOAD_DIR = path.join(process.cwd(), 'uploads');

// Ensure upload directory exists
if (!fs.existsSync(UPLOAD_DIR)) {
  fs.mkdirSync(UPLOAD_DIR, { recursive: true });
}

const storage = multer.diskStorage({
  destination: (_req, _file, cb) => cb(null, UPLOAD_DIR),
  filename: (_req, file, cb) => {
    const unique = `${Date.now()}-${Math.round(Math.random() * 1e6)}`;
    cb(null, `${unique}-${file.originalname.replace(/\s+/g, '_')}`);
  },
});

function fileFilter(
  _req: Request,
  file: Express.Multer.File,
  cb: FileFilterCallback,
): void {
  if (file.mimetype === 'application/pdf') {
    cb(null, true);
  } else {
    cb(new ValidationError('Only PDF files are accepted. Received: ' + file.mimetype));
  }
}

export const uploadResume = multer({
  storage,
  fileFilter,
  limits: {
    fileSize: 5 * 1024 * 1024, // 5 MB
    files: 1,
  },
}).single('resume');

/**
 * Wraps multer's callback-based upload in a promise so it can be used
 * with express-async-errors / async route handlers.
 */
export function uploadResumeAsync(
  req: Request,
  res: import('express').Response,
): Promise<void> {
  return new Promise((resolve, reject) => {
    uploadResume(req, res, (err) => {
      if (err instanceof multer.MulterError) {
        reject(new ValidationError(`File upload error: ${err.message}`));
      } else if (err) {
        reject(err);
      } else {
        resolve();
      }
    });
  });
}
