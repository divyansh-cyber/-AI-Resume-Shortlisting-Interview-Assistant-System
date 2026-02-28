/**
 * Jest global setup — runs before any test file is loaded.
 * Sets environment variables so config/index.ts validates without a real .env
 */
process.env.NODE_ENV = 'test';
process.env.GEMINI_API_KEY = 'test-gemini-key';
process.env.GEMINI_CHAT_MODEL = 'gemini-1.5-pro';
process.env.GEMINI_EMBEDDING_MODEL = 'text-embedding-004';
process.env.POSTGRES_HOST = 'localhost';
process.env.POSTGRES_PORT = '5432';
process.env.POSTGRES_DB = 'resume_system_test';
process.env.POSTGRES_USER = 'postgres';
process.env.POSTGRES_PASSWORD = 'postgres';
process.env.REDIS_HOST = 'localhost';
process.env.REDIS_PORT = '6379';
process.env.REDIS_CACHE_TTL = '86400';
process.env.PORT = '3001';
