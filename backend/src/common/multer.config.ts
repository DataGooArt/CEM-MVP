import { diskStorage } from 'multer';
import { extname, join } from 'path';
import { existsSync, mkdirSync } from 'fs';
import { BadRequestException } from '@nestjs/common';

const uploadsBase = process.env.UPLOADS_PATH || join(process.cwd(), 'uploads');

function ensureDir(dir: string) {
  if (!existsSync(dir)) mkdirSync(dir, { recursive: true });
}

export const logoMulterOptions = {
  storage: diskStorage({
    destination: (_req, _file, cb) => {
      const dir = join(uploadsBase, 'logos');
      ensureDir(dir);
      cb(null, dir);
    },
    filename: (_req, file, cb) => {
      const unique = Date.now() + '-' + Math.round(Math.random() * 1e6);
      cb(null, `logo-${unique}${extname(file.originalname)}`);
    },
  }),
  limits: { fileSize: 2 * 1024 * 1024 }, // 2MB
  fileFilter: (_req: any, file: any, cb: any) => {
    if (!file.mimetype.match(/^image\//)) {
      return cb(new BadRequestException('Solo se permiten imágenes'), false);
    }
    cb(null, true);
  },
};

export const csvMulterOptions = {
  storage: diskStorage({
    destination: (_req, _file, cb) => {
      const dir = join(uploadsBase, 'imports');
      ensureDir(dir);
      cb(null, dir);
    },
    filename: (_req, file, cb) => {
      const unique = Date.now() + '-' + Math.round(Math.random() * 1e6);
      cb(null, `import-${unique}${extname(file.originalname)}`);
    },
  }),
  limits: { fileSize: 5 * 1024 * 1024 }, // 5MB
  fileFilter: (_req: any, file: any, cb: any) => {
    const allowed = ['.csv', '.xlsx', '.xls'];
    if (!allowed.includes(extname(file.originalname).toLowerCase())) {
      return cb(new BadRequestException('Solo se permiten archivos CSV o Excel'), false);
    }
    cb(null, true);
  },
};

export const evidenceMulterOptions = {
  storage: diskStorage({
    destination: (_req, _file, cb) => {
      const dir = join(uploadsBase, 'evidence');
      ensureDir(dir);
      cb(null, dir);
    },
    filename: (_req, file, cb) => {
      const unique = Date.now() + '-' + Math.round(Math.random() * 1e6);
      cb(null, `evidence-${unique}${extname(file.originalname)}`);
    },
  }),
  limits: { fileSize: 10 * 1024 * 1024 }, // 10MB
  fileFilter: (_req: any, file: any, cb: any) => {
    const allowed = ['.pdf', '.png', '.jpg', '.jpeg', '.gif', '.webp', '.docx', '.doc'];
    if (!allowed.includes(extname(file.originalname).toLowerCase())) {
      return cb(new BadRequestException('Tipo de archivo no permitido para evidencia'), false);
    }
    cb(null, true);
  },
};
