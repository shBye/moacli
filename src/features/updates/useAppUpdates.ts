import { useCallback, useEffect, useRef, useState } from 'react'
import type { AppUpdateInfo, CliAgentApi } from '../../../electron/contracts'

type AppUpdatePort = Pick<CliAgentApi, 'getAppVersion' | 'checkForAppUpdate' | 'downloadAppUpdate'>

export interface AppUpdatesState {
  appVersion: string
  update: AppUpdateInfo | null
  checking: boolean
  opening: boolean
  error: string
  checkUpdate: (force?: boolean) => Promise<void>
  openDownload: () => Promise<void>
}

const INITIAL_CHECK_DELAY_MS = 3_500
const PERIODIC_CHECK_INTERVAL_MS = 6 * 60 * 60_000

export function useAppUpdates(port: AppUpdatePort): AppUpdatesState {
  const [appVersion, setAppVersion] = useState('')
  const [update, setUpdate] = useState<AppUpdateInfo | null>(null)
  const [checking, setChecking] = useState(false)
  const [opening, setOpening] = useState(false)
  const [error, setError] = useState('')
  const mountedRef = useRef(true)
  const checkInFlightRef = useRef(false)
  const openInFlightRef = useRef(false)

  const checkUpdate = useCallback(async (force = false): Promise<void> => {
    if (checkInFlightRef.current) return
    checkInFlightRef.current = true
    if (mountedRef.current) {
      setChecking(true)
      setError('')
    }
    try {
      const info = await port.checkForAppUpdate(force)
      if (!mountedRef.current) return
      setUpdate(info)
      setAppVersion(info.currentVersion)
    } catch (caught) {
      if (mountedRef.current) setError(caught instanceof Error ? caught.message : String(caught))
    } finally {
      checkInFlightRef.current = false
      if (mountedRef.current) setChecking(false)
    }
  }, [port])

  const openDownload = useCallback(async (): Promise<void> => {
    if (openInFlightRef.current) return
    openInFlightRef.current = true
    if (mountedRef.current) {
      setOpening(true)
      setError('')
    }
    try {
      const opened = await port.downloadAppUpdate()
      if (!opened) await checkUpdate(true)
    } catch (caught) {
      if (mountedRef.current) setError(caught instanceof Error ? caught.message : String(caught))
    } finally {
      openInFlightRef.current = false
      if (mountedRef.current) setOpening(false)
    }
  }, [checkUpdate, port])

  useEffect(() => {
    mountedRef.current = true
    void port.getAppVersion().then((version) => {
      if (mountedRef.current) setAppVersion(version)
    }).catch(() => undefined)
    const initialCheck = window.setTimeout(() => void checkUpdate(), INITIAL_CHECK_DELAY_MS)
    const periodicCheck = window.setInterval(() => void checkUpdate(), PERIODIC_CHECK_INTERVAL_MS)
    return () => {
      mountedRef.current = false
      window.clearTimeout(initialCheck)
      window.clearInterval(periodicCheck)
    }
  }, [checkUpdate, port])

  return { appVersion, update, checking, opening, error, checkUpdate, openDownload }
}
