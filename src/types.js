// @ts-check

/**
 * @typedef {'dropbox' | 'onedrive' | 'gdrive' | 'gphotos'} ProviderId
 * @typedef {'dropbox-content-hash' | 'md5' | 'sha1' | 'quickXor'} HashAlgo
 * @typedef {'connect' | 'trash' | 'album'} OAuthPurpose
 * @typedef {'content' | 'weak'} MatchKind
 */

/**
 * @typedef {Object} CloudFile
 * @property {string} id
 * @property {ProviderId} provider
 * @property {string} name
 * @property {string} path
 * @property {number | null} size
 * @property {string | null} hash
 * @property {HashAlgo | null} hashAlgo
 * @property {boolean} trashable
 */

/**
 * @typedef {Object} DuplicateGroup
 * @property {string} id
 * @property {MatchKind} match
 * @property {HashAlgo | null} hashAlgo
 * @property {string | null} hash
 * @property {number} count
 * @property {number | null} size
 * @property {number | null} wastedBytes
 * @property {CloudFile[]} files
 */

/**
 * @typedef {Object} ProviderToken
 * @property {string} accessToken
 * @property {string | null} refreshToken
 * @property {string[]} scopes
 * @property {number} obtainedAt
 */

/**
 * @typedef {Object} OAuthTxn
 * @property {ProviderId} provider
 * @property {OAuthPurpose} purpose
 * @property {string} state
 * @property {string} verifier
 * @property {string} redirectUri
 * @property {string[]} scopes
 * @property {number} createdAt
 */

/**
 * @typedef {Object} ReviewAlbum
 * @property {string} id
 * @property {string} title
 * @property {string[]} mediaItemIds
 */

/**
 * @typedef {Object} MockState
 * @property {CloudFile[]} files
 * @property {CloudFile[]} trash
 * @property {ReviewAlbum[]} albums
 */

/**
 * @typedef {Object} SessionData
 * @property {string} csrf
 * @property {Record<string, ProviderToken>} providers
 * @property {Record<string, OAuthTxn>} oauth
 * @property {{ groups: DuplicateGroup[], scannedAt: number } | null} scan
 * @property {MockState} mock
 */

/**
 * @typedef {Object} ClientCredentials
 * @property {string} id
 * @property {string} secret
 */

/**
 * @typedef {Object} AppConfig
 * @property {boolean} production
 * @property {number} port
 * @property {string} host
 * @property {string} publicBase
 * @property {boolean} mock
 * @property {boolean} persist
 * @property {Buffer} signingKey
 * @property {boolean} signingKeyEphemeral
 * @property {Buffer | null} tokenKey
 * @property {boolean} tokenKeyEphemeral
 * @property {string[]} allowedRedirects
 * @property {Record<ProviderId, ClientCredentials>} clients
 * @property {string} dataDir
 */

export {};
