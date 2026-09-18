// @vitest-environment jsdom

import { act } from "react";
import { createRoot } from "react-dom/client";
import { afterEach, describe, expect, it, vi } from "vitest";
import { App } from "../src/web/App";
import { api } from "../src/web/api";
import type { Resource, ResourceDetails, Session } from "../src/web/types";

const session: Session = {
  user: {
    id: "user-jordan",
    name: "Jordan",
    workspaceId: "workspace-a",
    role: "owner",
  },
  csrfToken: "test-csrf",
  expiresAt: "2026-08-29T00:30:00.000Z",
};

const folder: Resource = {
  id: "res_01K3ROOTAAAA",
  workspaceId: "workspace-a",
  parentId: null,
  kind: "folder",
  name: "Workspace A",
  ownerId: "user-jordan",
  mediaType: null,
  size: 0,
  version: 1,
  updatedAt: "2026-08-29T00:00:00.000Z",
  access: "owner",
};

const image: Resource = {
  ...folder,
  id: "res_01K3IMAGEAAA",
  parentId: folder.id,
  kind: "file",
  name: "preview.png",
  mediaType: "image/png",
  size: 80,
};

const childFolder: Resource = {
  ...folder,
  id: "res_01K3FOLDERAA",
  parentId: folder.id,
  name: "Launch assets",
  access: "owner",
};

const secondFolder: Resource = {
  ...childFolder,
  id: "res_01K3FOLDERBB",
  name: "Archive",
};

afterEach(() => vi.restoreAllMocks());

async function settle(): Promise<void> {
  await act(async () => {
    await Promise.resolve();
    await Promise.resolve();
  });
}

describe("P8 explorer", () => {
  it("renders the focused shell and revokes a Blob preview on unmount", async () => {
    Object.assign(globalThis, { IS_REACT_ACT_ENVIRONMENT: true });
    vi.spyOn(api, "session").mockResolvedValue(session);
    vi.spyOn(api, "list").mockResolvedValue({ folder, resources: [image] });
    vi.spyOn(api, "details").mockResolvedValue({
      resource: image,
      breadcrumbs: [folder, image],
      shares: [],
    });
    vi.spyOn(api, "content").mockResolvedValue(new Blob(["png"]));
    const createUrl = vi.fn(() => "blob:p8-preview");
    const revokeUrl = vi.fn();
    Object.defineProperties(URL, {
      createObjectURL: { configurable: true, value: createUrl },
      revokeObjectURL: { configurable: true, value: revokeUrl },
    });

    const target = document.createElement("div");
    document.body.append(target);
    const root = createRoot(target);
    await act(async () => root.render(<App />));
    await settle();

    expect(document.documentElement.textContent).toContain(
      "P8 - Securing File Sharing and Blocking Path Traversal with Cedarling",
    );
    const row = [...target.querySelectorAll("button")].find((button) =>
      button.textContent?.includes("preview.png"),
    );
    expect(row).toBeDefined();
    await act(async () => row?.click());
    await settle();
    expect(createUrl).toHaveBeenCalledOnce();
    expect(target.querySelector(".preview img")?.getAttribute("src")).toBe(
      "blob:p8-preview",
    );

    await act(async () => root.unmount());
    expect(revokeUrl).toHaveBeenCalledWith("blob:p8-preview");
    target.remove();
  });

  it("returns focus to the upload button when its dialog closes", async () => {
    Object.assign(globalThis, { IS_REACT_ACT_ENVIRONMENT: true });
    vi.spyOn(api, "session").mockResolvedValue(session);
    vi.spyOn(api, "list").mockResolvedValue({ folder, resources: [] });

    const target = document.createElement("div");
    document.body.append(target);
    const root = createRoot(target);
    await act(async () => root.render(<App />));
    await settle();

    const upload = target.querySelector<HTMLButtonElement>(
      'button[aria-label="Upload file"]',
    );
    expect(upload).not.toBeNull();
    await act(async () => upload?.click());
    const cancel = [...target.querySelectorAll("button")].find(
      (button) => button.textContent === "Cancel",
    );
    await act(async () => cancel?.click());

    expect(document.activeElement).toBe(upload);
    await act(async () => root.unmount());
    target.remove();
  });

  it("returns focus to the selected resource action when its dialog closes", async () => {
    Object.assign(globalThis, { IS_REACT_ACT_ENVIRONMENT: true });
    vi.spyOn(api, "session").mockResolvedValue(session);
    vi.spyOn(api, "list").mockResolvedValue({
      folder,
      resources: [childFolder],
    });
    vi.spyOn(api, "details").mockResolvedValue({
      resource: childFolder,
      breadcrumbs: [folder, childFolder],
      shares: [],
    });

    const target = document.createElement("div");
    document.body.append(target);
    const root = createRoot(target);
    await act(async () => root.render(<App />));
    await settle();
    const row = [...target.querySelectorAll("button")].find((button) =>
      button.textContent?.includes("Launch assets"),
    );
    await act(async () => row?.click());
    await settle();

    const share = [...target.querySelectorAll("button")].find(
      (button) => button.textContent === "Share",
    );
    expect(share).toBeDefined();
    await act(async () => share?.click());
    const cancel = [...target.querySelectorAll("button")].find(
      (button) => button.textContent === "Cancel",
    );
    await act(async () => cancel?.click());

    expect(document.activeElement).toBe(share);
    await act(async () => root.unmount());
    target.remove();
  });

  it("clears stale details while a new selection loads", async () => {
    Object.assign(globalThis, { IS_REACT_ACT_ENVIRONMENT: true });
    vi.spyOn(api, "session").mockResolvedValue(session);
    vi.spyOn(api, "list").mockResolvedValue({
      folder,
      resources: [childFolder, secondFolder],
    });

    let resolveSecond!: (details: ResourceDetails) => void;
    const secondDetails = new Promise<ResourceDetails>((resolve) => {
      resolveSecond = resolve;
    });
    vi.spyOn(api, "details").mockImplementation((id) => {
      if (id === childFolder.id) {
        return Promise.resolve({
          resource: childFolder,
          breadcrumbs: [folder, childFolder],
          shares: [],
        });
      }
      return secondDetails;
    });

    const target = document.createElement("div");
    document.body.append(target);
    const root = createRoot(target);
    await act(async () => root.render(<App />));
    await settle();

    const first = [...target.querySelectorAll("button")].find((button) =>
      button.textContent?.includes(childFolder.name),
    );
    await act(async () => first?.click());
    await settle();
    expect(target.querySelector(".detail-title h2")?.textContent).toBe(
      childFolder.name,
    );

    const second = [...target.querySelectorAll("button")].find((button) =>
      button.textContent?.includes(secondFolder.name),
    );
    await act(async () => second?.click());
    expect(target.querySelector(".detail-title")).toBeNull();
    expect(target.querySelector(".detail .state")?.textContent).toContain(
      "Loading resource",
    );

    await act(async () => {
      resolveSecond({
        resource: secondFolder,
        breadcrumbs: [folder, secondFolder],
        shares: [],
      });
      await secondDetails;
    });
    expect(target.querySelector(".detail-title h2")?.textContent).toBe(
      secondFolder.name,
    );

    await act(async () => root.unmount());
    target.remove();
  });
});
