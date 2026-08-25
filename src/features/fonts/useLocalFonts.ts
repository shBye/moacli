import { useCallback, useEffect, useRef, useState } from 'react'
import { uniqueFontFamilies, type LocalFontRecord } from './local-fonts'

type QueryLocalFonts = () => Promise<LocalFontRecord[]>

export interface LocalFontsState {
  families: string[]
  status: string
  discover: () => void
}

export function useLocalFonts(queryLocalFonts?: QueryLocalFonts): LocalFontsState {
  const [families, setFamilies] = useState<string[]>([])
  const [status, setStatus] = useState('')
  const mountedRef = useRef(true)
  const requestIdRef = useRef(0)

  useEffect(() => {
    mountedRef.current = true
    return () => {
      mountedRef.current = false
      requestIdRef.current += 1
    }
  }, [])

  const discover = useCallback((): void => {
    if (!queryLocalFonts) {
      setStatus('Local font discovery is unavailable. Enter the family name manually.')
      return
    }
    const requestId = requestIdRef.current + 1
    requestIdRef.current = requestId
    setStatus('Loading installed fonts...')
    void queryLocalFonts().then((fonts) => {
      if (!mountedRef.current || requestId !== requestIdRef.current) return
      const nextFamilies = uniqueFontFamilies(fonts)
      setFamilies(nextFamilies)
      setStatus(nextFamilies.length ? `${nextFamilies.length} font families available` : 'No installed fonts were returned')
    }).catch(() => {
      if (mountedRef.current && requestId === requestIdRef.current) {
        setStatus('Font access was denied. Enter the family name manually.')
      }
    })
  }, [queryLocalFonts])

  return { families, status, discover }
}
