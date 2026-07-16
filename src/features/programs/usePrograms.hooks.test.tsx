/* eslint-disable import/first */

const mockQueryProgramPage = jest.fn();
const mockQueryProgramById = jest.fn();
const mockQueryProgramCities = jest.fn();
const mockQueryProgramLanguages = jest.fn();
let mockContentRevision = 0;

jest.mock('@/data/content', () => ({
  useContentRevisionStore: (selector: (state: { revision: number }) => unknown) =>
    selector({ revision: mockContentRevision }),
}));

jest.mock('@/db/programRepository', () => ({
  queryProgramPage: (...args: unknown[]) => mockQueryProgramPage(...args),
  queryProgramById: (...args: unknown[]) => mockQueryProgramById(...args),
  queryProgramCities: (...args: unknown[]) => mockQueryProgramCities(...args),
  queryProgramLanguages: (...args: unknown[]) => mockQueryProgramLanguages(...args),
}));

import { act, renderHook, waitFor } from '@testing-library/react-native';

import { useProgram, useProgramFacets, usePrograms } from './usePrograms';

(
  globalThis as typeof globalThis & { IS_REACT_ACT_ENVIRONMENT?: boolean }
).IS_REACT_ACT_ENVIRONMENT = true;

describe('program data hooks', () => {
  beforeEach(() => {
    jest.clearAllMocks();
    mockContentRevision = 0;
  });

  it('exposes an initial page error and retries the same query', async () => {
    mockQueryProgramPage
      .mockRejectedValueOnce(new Error('database unavailable'))
      .mockResolvedValueOnce({ programs: [], hasMore: false });

    const { result } = await renderHook(() => usePrograms({ scoreType: 'say', language: 'tr' }));

    await waitFor(() => expect(result.current.error?.message).toBe('database unavailable'));
    expect(result.current.loading).toBe(false);

    await act(() => {
      result.current.retry();
    });

    await waitFor(() => expect(result.current.error).toBeNull());
    expect(result.current.loading).toBe(false);
    expect(mockQueryProgramPage).toHaveBeenCalledTimes(2);
  });

  it('does not load facets until enabled and reuses them across sheet reopen', async () => {
    mockQueryProgramCities.mockResolvedValue(['ANKARA']);
    mockQueryProgramLanguages.mockResolvedValue(['Türkçe']);

    const { result, rerender } = await renderHook(
      ({ enabled }: { enabled: boolean }) => useProgramFacets('tr', enabled),
      { initialProps: { enabled: false } },
    );

    expect(mockQueryProgramCities).not.toHaveBeenCalled();
    expect(mockQueryProgramLanguages).not.toHaveBeenCalled();

    await rerender({ enabled: true });
    await waitFor(() => expect(result.current.cities).toEqual(['ANKARA']));
    expect(result.current.languages).toEqual(['Türkçe']);

    await rerender({ enabled: false });
    await rerender({ enabled: true });

    expect(mockQueryProgramCities).toHaveBeenCalledTimes(1);
    expect(mockQueryProgramLanguages).toHaveBeenCalledTimes(1);
  });

  it('exposes facet failures and retries them', async () => {
    mockQueryProgramCities
      .mockRejectedValueOnce(new Error('facet read failed'))
      .mockResolvedValueOnce(['İSTANBUL']);
    mockQueryProgramLanguages.mockResolvedValue(['İngilizce']);

    const { result } = await renderHook(() => useProgramFacets('tr', true));

    await waitFor(() => expect(result.current.error?.message).toBe('facet read failed'));
    await act(() => {
      result.current.retry();
    });
    await waitFor(() => expect(result.current.cities).toEqual(['İSTANBUL']));

    expect(result.current.error).toBeNull();
    expect(mockQueryProgramCities).toHaveBeenCalledTimes(2);
    expect(mockQueryProgramLanguages).toHaveBeenCalledTimes(2);
  });

  it('keeps detail read failures separate from a missing program and retries', async () => {
    mockQueryProgramById
      .mockRejectedValueOnce(new Error('detail read failed'))
      .mockResolvedValueOnce(null);

    const { result } = await renderHook(() => useProgram('123'));

    await waitFor(() => expect(result.current.error?.message).toBe('detail read failed'));
    await act(() => {
      result.current.retry();
    });
    await waitFor(() => expect(result.current.error).toBeNull());

    expect(result.current.loading).toBe(false);
    expect(result.current.program).toBeNull();
    expect(mockQueryProgramById).toHaveBeenCalledTimes(2);
  });
});
