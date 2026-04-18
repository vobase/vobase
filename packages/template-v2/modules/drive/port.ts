/**
 * DrivePort implementation.
 * REAL: get (via getByPath), getByPath, listFolder, readContent.
 * Scaffold: all write methods throw not-implemented-in-phase-1.
 */
import type { DrivePort } from '@server/contracts/drive-port'
import { files } from './service'

export function createDrivePort(): DrivePort {
  return {
    async get(id) {
      return files.get(id)
    },
    async getByPath(scope, path) {
      return files.getByPath(scope, path)
    },
    async listFolder(scope, parentId) {
      return files.listFolder(scope, parentId)
    },
    async readContent(id) {
      return files.readContent(id)
    },
    async grep(scope, pattern, opts) {
      return files.grep(scope, pattern, opts)
    },
    async create(scope, input) {
      return files.create(scope, input)
    },
    async mkdir(scope, path) {
      return files.mkdir(scope, path)
    },
    async move(id, newPath) {
      return files.move(id, newPath)
    },
    async delete(id) {
      return files.remove(id)
    },
    async ingestUpload(input) {
      return files.ingestUpload(input)
    },
    async saveInboundMessageAttachment(msgId, targetPath) {
      return files.saveInboundMessageAttachment(msgId, targetPath)
    },
    async deleteScope(scope, scopeId) {
      return files.deleteScope(scope, scopeId)
    },
  }
}
