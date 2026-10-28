export type MalwareScanResult =
  | { status: 'not-configured' }
  | { status: 'clean' }
  | { status: 'infected'; detail?: string }

export async function scanSubmissionFiles(objectKeys: string[]): Promise<MalwareScanResult> {
  // Integration point for a malware-scanning provider; no files are considered scanned here.
  void objectKeys
  return { status: 'not-configured' }
}
