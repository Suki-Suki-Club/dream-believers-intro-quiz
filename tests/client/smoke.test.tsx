import { render, screen } from '@testing-library/react';
import App from '../../src/App';

describe('App', () => {
  it('renders the quiz title', () => {
    render(<App />);

    expect(
      screen.getByRole('heading', { name: /Dream\s*Believers/i }),
    ).toBeInTheDocument();
  });
});
