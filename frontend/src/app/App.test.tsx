import { cleanup, fireEvent, render, screen, waitFor, within } from "@testing-library/react";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";

import App from "./App";
import { MemoryRouter } from "react-router-dom";

const profileResponse = {
  profiles: [
    {
      profile_id: "home",
      name: "Home files",
      sources: ["C:\\Users\\Example\\Documents"],
      target: "D:\\Backups",
      excludes: [],
    },
  ],
};

function mockApi() {
  vi.stubGlobal(
    "fetch",
    vi.fn(async (input: RequestInfo | URL) => {
      const url = String(input);
      const payload =
        url.endsWith("/health")
          ? { status: "ok", version: "0.1.0" }
          : url.endsWith("/system/info")
            ? { platform: "Windows", python_version: "3.12.7", rsync_available: false }
            : profileResponse;
      return new Response(JSON.stringify(payload), {
        status: 200,
        headers: { "Content-Type": "application/json" },
      });
    }),
  );
}

describe("BackInTime app", () => {
  beforeEach(() => mockApi());
  afterEach(cleanup);

  it("renders real API status, configured profile and honest feature status", async () => {
    render(
      <MemoryRouter>
        <App />
      </MemoryRouter>,
    );

    expect(await screen.findByText("Service is ready")).toBeInTheDocument();
    expect(screen.getByText("Home files")).toBeInTheDocument();
    expect(screen.getByText(/No backup has been run by this application/)).toBeInTheDocument();
    expect(screen.getByText("Not installed")).toBeInTheDocument();
  });

  it("shows an actionable message when the API is unreachable", async () => {
    vi.stubGlobal("fetch", vi.fn().mockRejectedValue(new TypeError("offline")));

    render(
      <MemoryRouter>
        <App />
      </MemoryRouter>,
    );

    expect(await screen.findByText("Service is unavailable")).toBeInTheDocument();
    await waitFor(() => expect(screen.getAllByRole("alert").length).toBeGreaterThanOrEqual(2));
    expect(screen.getAllByText("Could not reach the local BackInTime API.").length).toBeGreaterThan(0);
  });

  it("navigates to the profiles view", async () => {
    render(
      <MemoryRouter>
        <App />
      </MemoryRouter>,
    );

    fireEvent.click(
      within(screen.getByRole("navigation")).getByRole("link", { name: /Profiles/ }),
    );

    expect(await screen.findByText("Configured profiles")).toBeInTheDocument();
    await waitFor(() => expect(screen.getAllByText("Home files").length).toBeGreaterThan(0));
  });

  it("retries a failed profile request from the error state", async () => {
    let profileAttempts = 0;
    vi.stubGlobal(
      "fetch",
      vi.fn(async (input: RequestInfo | URL) => {
        if (String(input).endsWith("/profiles") && ++profileAttempts <= 2) {
          throw new TypeError("offline");
        }
        return new Response(JSON.stringify(profileResponse), {
          status: 200,
          headers: { "Content-Type": "application/json" },
        });
      }),
    );

    render(
      <MemoryRouter initialEntries={["/profiles"]}>
        <App />
      </MemoryRouter>,
    );

    fireEvent.click(await screen.findByRole("button", { name: "Retry loading profiles" }));
    expect(await screen.findByRole("alert")).toHaveTextContent("Could not reach the local BackInTime API.");

    fireEvent.click(await screen.findByRole("button", { name: "Retry loading profiles" }));
    expect(await screen.findByText("Home files")).toBeInTheDocument();
    expect(screen.queryByRole("alert")).not.toBeInTheDocument();
  });

  it("refreshes profiles without sending duplicate requests", async () => {
    render(
      <MemoryRouter initialEntries={["/profiles"]}>
        <App />
      </MemoryRouter>,
    );
    expect(await screen.findByText("Home files")).toBeInTheDocument();

    const fetchMock = vi.mocked(fetch);
    const profileCalls = () =>
      fetchMock.mock.calls.filter(([input]) => String(input).endsWith("/profiles")).length;
    const before = profileCalls();
    let release: () => void = () => undefined;
    fetchMock.mockImplementationOnce(
      () =>
        new Promise<Response>((resolve) => {
          release = () =>
            resolve(
              new Response(JSON.stringify(profileResponse), {
                status: 200,
                headers: { "Content-Type": "application/json" },
              }),
            );
        }),
    );

    const button = screen.getByRole("button", { name: /Refresh profiles/ });
    fireEvent.click(button);
    const busy = await screen.findByRole("button", { name: /Refreshing/ });
    expect(busy).toBeDisabled();
    expect(busy).toHaveAttribute("aria-busy", "true");
    fireEvent.click(busy);
    expect(profileCalls()).toBe(before + 1);

    release();
    expect(await screen.findByRole("button", { name: /Refresh profiles/ })).toBeEnabled();
    expect(screen.getByText("Home files")).toBeInTheDocument();
  });
});
