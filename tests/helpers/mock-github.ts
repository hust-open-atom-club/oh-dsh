import { createServer, type Server } from 'node:http'
import { createHash } from 'node:crypto'

export const MOCK_REPO = 'hust-open-atom-club/oh-dsh'

type MockAsset = { name: string; bytes: Buffer; sha256: string; truncated?: boolean }

/**
 * Minimal GitHub REST + release-download mock shared by the installer test
 * suites. Mirrors the production JSON shape, including the nested uploader
 * object inside every asset.
 */
export class MockGitHub {
  private readonly releases = new Map<string, MockAsset[]>()
  private readonly downloads = new Map<string, number>()
  private readonly requests: string[] = []
  private authorizedDownloads = 0
  private authorizedApiRequests = 0
  private latestTag = ''
  private server: Server | undefined
  apiBase = ''
  downloadBase = ''
  /** Serve pretty-printed (whitespace-rich) JSON to exercise parser tolerance. */
  pretty = false

  async start(): Promise<void> {
    this.server = createServer((req, res) => {
      const url = new URL(req.url ?? '/', 'http://127.0.0.1')
      this.requests.push(`${req.method} ${url.pathname}`)
      const send = (status: number, body: string | Buffer, type: string) => {
        res.writeHead(status, { 'content-type': type })
        res.end(body)
      }
      const tagMatch = url.pathname.match(/\/releases\/tags\/([^/]+)$/)
      if (url.pathname.endsWith('/releases/latest') && this.latestTag) {
        if (req.headers.authorization !== undefined) this.authorizedApiRequests += 1
        send(200, this.releaseJson(this.latestTag), 'application/json')
        return
      }
      if (tagMatch && this.releases.has(tagMatch[1]!)) {
        send(200, this.releaseJson(tagMatch[1]!), 'application/json')
        return
      }
      const download = url.pathname.match(/\/releases\/download\/([^/]+)\/([^/]+)$/)
      if (download) {
        const asset = this.releases.get(download[1]!)?.find(
          candidate => candidate.name === download[2],
        )
        if (asset) {
          const key = `${download[1]}/${download[2]}`
          this.downloads.set(key, (this.downloads.get(key) ?? 0) + 1)
          if (req.headers.authorization !== undefined) this.authorizedDownloads += 1
          if (asset.truncated) {
            res.writeHead(200, {
              'content-type': 'application/octet-stream',
              'content-length': asset.bytes.length,
            })
            res.write(asset.bytes.subarray(0, Math.max(1, Math.floor(asset.bytes.length / 2))))
            res.destroy()
            return
          }
          send(200, asset.bytes, 'application/octet-stream')
          return
        }
      }
      send(404, '{"message":"Not Found"}', 'application/json')
    })
    await new Promise<void>(resolve => {
      this.server!.listen(0, '127.0.0.1', () => resolve())
    })
    const address = this.server!.address()
    if (address === null || typeof address === 'string') {
      throw new Error('mock GitHub server did not bind to a TCP port')
    }
    const base = `http://127.0.0.1:${address.port}`
    this.apiBase = base
    this.downloadBase = `${base}/dl`
  }

  async stop(): Promise<void> {
    await new Promise<void>((resolve, reject) => {
      this.server!.close(error => (error ? reject(error) : resolve()))
    })
  }

  publish(tag: string, files: Array<{ name: string; bytes: Buffer }>): void {
    const assets: MockAsset[] = files.map(file => ({
      name: file.name,
      bytes: file.bytes,
      sha256: createHash('sha256').update(file.bytes).digest('hex'),
    }))
    this.releases.set(tag, assets)
    if (!this.latestTag) this.latestTag = tag
  }

  setLatest(tag: string): void {
    this.latestTag = tag
  }

  tamperAsset(tag: string, name: string, bytes: Buffer): void {
    // Swap the served bytes while keeping the originally published digest,
    // so a verification failure can be exercised without touching metadata.
    const asset = this.releases.get(tag)?.find(candidate => candidate.name === name)
    if (asset === undefined) throw new Error(`unknown asset ${tag}/${name}`)
    asset.bytes = bytes
  }

  truncateAsset(tag: string, name: string): void {
    const asset = this.releases.get(tag)?.find(candidate => candidate.name === name)
    if (asset === undefined) throw new Error(`unknown asset ${tag}/${name}`)
    asset.truncated = true
  }

  releaseJson(tag: string): string {
    const assets = this.releases.get(tag) ?? []
    const payload = {
      url: `https://api.github.com/repos/${MOCK_REPO}/releases/1`,
      tag_name: tag,
      name: `Release ${tag}`,
      draft: false,
      prerelease: false,
      assets: assets.map((asset, index) => ({
        url: `https://api.github.com/repos/${MOCK_REPO}/releases/assets/${index}`,
        id: index,
        name: asset.name,
        label: '',
        uploader: {
          login: 'release-bot',
          id: 1,
          type: 'User',
        },
        content_type: 'application/octet-stream',
        state: 'uploaded',
        size: asset.bytes.length,
        digest: `sha256:${asset.sha256}`,
        browser_download_url: `https://github.com/${MOCK_REPO}/releases/download/${tag}/${asset.name}`,
      })),
    }
    return JSON.stringify(payload, null, this.pretty ? 2 : undefined)
  }

  /** API requests that carried an Authorization header (zero for custom bases). */
  authorizedApiRequestCount(): number {
    return this.authorizedApiRequests
  }

  /** Downloads that carried an Authorization header (must stay zero). */
  downloadsWithAuthorization(): number {
    return this.authorizedDownloads
  }

  downloadCount(tag: string, name: string): number {
    return this.downloads.get(`${tag}/${name}`) ?? 0
  }

  sawRequest(fragment: string): boolean {
    return this.requests.some(request => request.includes(fragment))
  }
}
