import { describe, expect, it } from 'vitest'
import { render, screen } from './render'
import { NavBar } from '../components/navigation/elements/TopNavBar'

describe('NavBar', () => {
  it('renders the main navigation links', () => {
    render(<NavBar />)

    // The toolbar buttons expose their label via aria-label.
    expect(screen.getByRole('button', { name: 'Open file' })).toBeInTheDocument()
    expect(screen.getByRole('button', { name: 'Settings' })).toBeInTheDocument()
    expect(screen.getByRole('button', { name: 'About' })).toBeInTheDocument()
  })
})
