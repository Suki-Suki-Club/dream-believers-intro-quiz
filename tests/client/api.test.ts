import {
  answer,
  ApiError,
  fetchSegment,
  getRanking,
  postRanking,
  SegmentUnavailableError,
  skip,
  startGame,
} from '../../src/api/client';

describe('API client', () => {
  let fetchMock: ReturnType<typeof vi.fn>;

  beforeEach(() => {
    fetchMock = vi.fn();
    vi.stubGlobal('fetch', fetchMock);
  });

  afterEach(() => {
    vi.unstubAllGlobals();
  });

  it('starts a game and parses the response', async () => {
    const body = {
      sessionId: 'session-1',
      questions: [{ choices: ['A', 'B', 'C', 'D', 'E', 'F'] }],
    };
    fetchMock.mockResolvedValueOnce(
      new Response(JSON.stringify(body), { status: 200 }),
    );

    await expect(startGame()).resolves.toEqual(body);
    expect(fetchMock).toHaveBeenCalledWith('/api/game/start', {
      method: 'POST',
    });
  });

  it('fetches a binary segment', async () => {
    const bytes = new Uint8Array([1, 2, 3]);
    fetchMock.mockResolvedValueOnce(new Response(bytes, { status: 200 }));

    await expect(fetchSegment('session-1', 2, 3)).resolves.toEqual(
      bytes.buffer,
    );
    expect(fetchMock).toHaveBeenCalledWith('/api/game/session-1/q/2/seg/3');
  });

  it('turns a segment 403 into a dedicated error', async () => {
    fetchMock.mockResolvedValueOnce(new Response(null, { status: 403 }));

    const request = fetchSegment('session-1', 0, 1);
    await expect(request).rejects.toBeInstanceOf(SegmentUnavailableError);
    await expect(request).rejects.toMatchObject({ status: 403 });
  });

  it('answers with a JSON body and parses the response', async () => {
    const body = { correct: true, finalMs: 12_345 };
    fetchMock.mockResolvedValueOnce(
      new Response(JSON.stringify(body), { status: 200 }),
    );

    await expect(answer('session-1', 2, 4)).resolves.toEqual(body);
    expect(fetchMock).toHaveBeenCalledWith(
      '/api/game/session-1/q/2/answer',
      {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ choice: 4 }),
      },
    );
  });

  it('skips a question with an empty POST response', async () => {
    fetchMock.mockResolvedValueOnce(new Response(null, { status: 204 }));

    await expect(skip('session-1', 2)).resolves.toBeUndefined();
    expect(fetchMock).toHaveBeenCalledWith('/api/game/session-1/q/2/skip', {
      method: 'POST',
    });
  });

  it('posts a ranking name and parses the rank', async () => {
    const body = { rank: 7 };
    fetchMock.mockResolvedValueOnce(
      new Response(JSON.stringify(body), { status: 200 }),
    );

    await expect(postRanking('session-1', 'Alice')).resolves.toEqual(body);
    expect(fetchMock).toHaveBeenCalledWith('/api/ranking', {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ sessionId: 'session-1', name: 'Alice' }),
    });
  });

  it('gets the ranking list', async () => {
    const body = [{ name: 'Alice', timeMs: 1234, createdAt: 5678 }];
    fetchMock.mockResolvedValueOnce(
      new Response(JSON.stringify(body), { status: 200 }),
    );

    await expect(getRanking()).resolves.toEqual(body);
    expect(fetchMock).toHaveBeenCalledWith('/api/ranking');
  });

  it('throws an error containing the status for other non-2xx responses', async () => {
    fetchMock.mockResolvedValueOnce(new Response(null, { status: 409 }));
    const request = getRanking();

    await expect(request).rejects.toBeInstanceOf(ApiError);
    await expect(request).rejects.toMatchObject({ status: 409 });
  });
});
