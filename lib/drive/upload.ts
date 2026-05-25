import { Readable } from 'node:stream'
import { google } from 'googleapis'
import type { JWT } from 'google-auth-library'

const DRIVE_SCOPES = ['https://www.googleapis.com/auth/drive.file']
const FORGE_PHOTOS_FOLDER_NAME = 'Forge Photos'
const FOLDER_MIME = 'application/vnd.google-apps.folder'

// Module-scoped cache so we don't re-fetch folder IDs on every upload.
let rootFolderIdCache: string | null = null
const jobFolderIdCache = new Map<string, string>()

function getBusinessEmail(): string {
  const email = process.env.BUSINESS_EMAIL
  if (!email) throw new Error('BUSINESS_EMAIL is not configured')
  return email
}

function getAuth(): JWT {
  const clientEmail = process.env.GOOGLE_SERVICE_ACCOUNT_EMAIL
  const privateKey = process.env.GOOGLE_PRIVATE_KEY?.replace(/\\n/g, '\n')
  if (!clientEmail || !privateKey) {
    throw new Error(
      'GOOGLE_SERVICE_ACCOUNT_EMAIL and GOOGLE_PRIVATE_KEY must be set',
    )
  }
  // Impersonate the business email so files land in admin@'s My Drive directly.
  return new google.auth.JWT({
    email: clientEmail,
    key: privateKey,
    scopes: DRIVE_SCOPES,
    subject: getBusinessEmail(),
  })
}

function getDrive() {
  return google.drive({ version: 'v3', auth: getAuth() })
}

async function findFolderId(
  drive: ReturnType<typeof getDrive>,
  name: string,
  parentId: string,
): Promise<string | null> {
  const escapedName = name.replace(/'/g, "\\'")
  const q = `name='${escapedName}' and mimeType='${FOLDER_MIME}' and '${parentId}' in parents and trashed=false`
  const response = await drive.files.list({
    q,
    fields: 'files(id,name)',
    pageSize: 1,
    spaces: 'drive',
  })
  const files = response.data.files ?? []
  return files[0]?.id ?? null
}

async function createFolder(
  drive: ReturnType<typeof getDrive>,
  name: string,
  parentId: string,
): Promise<string> {
  const response = await drive.files.create({
    requestBody: {
      name,
      mimeType: FOLDER_MIME,
      parents: [parentId],
    },
    fields: 'id',
  })
  const id = response.data.id
  if (!id) throw new Error(`Drive folder create returned no ID for ${name}`)
  return id
}

async function ensureForgePhotosRoot(
  drive: ReturnType<typeof getDrive>,
): Promise<string> {
  if (rootFolderIdCache) return rootFolderIdCache
  const existing = await findFolderId(drive, FORGE_PHOTOS_FOLDER_NAME, 'root')
  if (existing) {
    rootFolderIdCache = existing
    return existing
  }
  const created = await createFolder(drive, FORGE_PHOTOS_FOLDER_NAME, 'root')
  rootFolderIdCache = created
  return created
}

async function ensureJobFolder(
  drive: ReturnType<typeof getDrive>,
  jobId: string,
): Promise<string> {
  const cached = jobFolderIdCache.get(jobId)
  if (cached) return cached
  const root = await ensureForgePhotosRoot(drive)
  const existing = await findFolderId(drive, jobId, root)
  if (existing) {
    jobFolderIdCache.set(jobId, existing)
    return existing
  }
  const created = await createFolder(drive, jobId, root)
  jobFolderIdCache.set(jobId, created)
  return created
}

export interface UploadedPhoto {
  id: string
  name: string
  webViewLink: string
  thumbnailLink: string | null
}

export async function uploadPhoto(input: {
  jobId: string
  fileName: string
  mimeType: string
  buffer: Buffer
}): Promise<UploadedPhoto> {
  const drive = getDrive()
  const folderId = await ensureJobFolder(drive, input.jobId)
  const response = await drive.files.create({
    requestBody: {
      name: input.fileName,
      parents: [folderId],
    },
    media: {
      mimeType: input.mimeType,
      body: Readable.from(input.buffer),
    },
    fields: 'id,name,webViewLink,thumbnailLink',
  })
  const file = response.data
  if (!file.id || !file.webViewLink) {
    throw new Error('Drive upload returned incomplete file metadata')
  }
  return {
    id: file.id,
    name: file.name ?? input.fileName,
    webViewLink: file.webViewLink,
    thumbnailLink: file.thumbnailLink ?? null,
  }
}
