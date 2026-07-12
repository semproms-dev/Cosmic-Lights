import { describe, expect, it } from 'vitest'
import { render, screen } from './render'
import { NavBar } from '../components/navigation/elements/TopNavBar'

describe('NavBar', () => {
  it('renders the main navigation links', () => {
    render(<NavBar />)

    // The menu buttons expose their label via aria-label.
    expect(screen.getByRole('button', { name: 'File' })).toBeInTheDocument()
    expect(screen.getByRole('button', { name: 'Settings' })).toBeInTheDocument()
    expect(screen.getByRole('button', { name: 'Hello' })).toBeInTheDocument()
  })
})
