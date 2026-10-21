// @vitest-environment jsdom

import { act } from "react";
import { createRoot } from "react-dom/client";
import { afterEach, describe, expect, it, vi } from "vitest";
import { App } from "../src/web/App";
import { api, ApiError } from "../src/web/api";
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
  it("keeps a failed form's error and entered name until the learner corrects it", async () => {
    Object.assign(globalThis, { IS_REACT_ACT_ENVIRONMENT: true });
    vi.useFakeTimers();
    vi.spyOn(api, "session").mockResolvedValue(session);
    vi.spyOn(api, "list").mockResolvedValue({ folder, resources: [] });
    vi.spyOn(api, "createFolder").mockRejectedValue(
      new ApiError(409, "name_collision"),
    );
    const target = document.createElement("div");
    document.body.append(target);
    const root = createRoot(target);
    try {
      await act(async () => root.render(<App />));
      await act(async () =>
        target
          .querySelector<HTMLButtonElement>('[aria-label="Create folder"]')
          ?.click(),
      );
      const input = target.querySelector<HTMLInputElement>(
        '[role="dialog"] input',
      );
      const form = target.querySelector(".dialog-form");
      if (!input || !form) throw new Error("Folder form was not rendered");
      await act(async () => {
        Object.getOwnPropertyDescriptor(
          HTMLInputElement.prototype,
          "value",
        )?.set?.call(input, "Existing folder");
        input.dispatchEvent(new Event("input", { bubbles: true }));
      });
      await act(async () =>
        form.dispatchEvent(
          new Event("submit", { bubbles: true, cancelable: true }),
        ),
      );
      await act(async () => vi.advanceTimersByTime(20_000));
      expect(
        target.querySelector('[role="dialog"] [role="alert"]')?.textContent,
      ).toContain("A sibling already uses that name");
      expect(input.value).toBe("Existing folder");
      expect(target.querySelector(".transient-notice")).toBeNull();
    } finally {
      await act(async () => root.unmount());
      target.remove();
      vi.useRealTimers();
    }
  });

  it("opens a shared folder on double-click and enables destination actions without a role check", async () => {
    Object.assign(globalThis, { IS_REACT_ACT_ENVIRONMENT: true });
    vi.spyOn(api, "session").mockResolvedValue({
      ...session,
      user: { ...session.user, id: "user-priya", name: "Priya", role: "guest" },
    });
    vi.spyOn(api, "list").mockImplementation(async (id) =>
      id === childFolder.id
        ? { folder: { ...childFolder, access: "viewer" }, resources: [image] }
        : { folder: null, resources: [childFolder] },
    );
    vi.spyOn(api, "details").mockResolvedValue({
      resource: childFolder,
      breadcrumbs: [childFolder],
      shares: [],
    });
    const target = document.createElement("div");
    document.body.append(target);
    const root = createRoot(target);
    try {
      await act(async () => root.render(<App />));
      const upload = () =>
        target.querySelector<HTMLButtonElement>('[aria-label="Upload file"]');
      expect(upload()?.disabled).toBe(true);
      const row = target.querySelector<HTMLButtonElement>(".resource-row");
      await act(async () => row?.click());
      expect(api.list).toHaveBeenCalledTimes(1);
      await act(async () =>
        row?.dispatchEvent(new MouseEvent("dblclick", { bubbles: true })),
      );
      expect(api.list).toHaveBeenLastCalledWith(childFolder.id);
      expect(target.querySelector(".explorer h2")?.textContent).toBe(
        "Launch assets",
      );
      expect(upload()?.disabled).toBe(false);
      expect(
        target.querySelector<HTMLButtonElement>('[aria-label="Create folder"]')
          ?.disabled,
      ).toBe(false);
      expect(target.querySelector(".resource-row")?.textContent).toContain(
        image.name,
      );
      expect(
        target.querySelector(".workspace")?.classList.contains("has-selection"),
      ).toBe(false);
    } finally {
      await act(async () => root.unmount());
      target.remove();
    }
  });

  it("keeps a focused mobile return control while details load or fail", async () => {
    Object.assign(globalThis, { IS_REACT_ACT_ENVIRONMENT: true });
    vi.stubGlobal("matchMedia", () => ({ matches: true }));
    vi.spyOn(api, "session").mockResolvedValue(session);
    vi.spyOn(api, "list").mockResolvedValue({
      folder,
      resources: [childFolder],
    });
    let rejectDetails!: (error: Error) => void;
    vi.spyOn(api, "details").mockReturnValue(
      new Promise((_resolve, reject) => {
        rejectDetails = reject;
      }),
    );
    const target = document.createElement("div");
    document.body.append(target);
    const root = createRoot(target);
    try {
      await act(async () => root.render(<App />));
      const resource =
        target.querySelector<HTMLButtonElement>("[data-resource-id]");
      await act(async () => resource?.click());
      const back = target.querySelector<HTMLButtonElement>(".mobile-back");
      expect(back).not.toBeNull();
      expect(document.activeElement).toBe(back);
      await act(async () => rejectDetails(new Error("Request unavailable")));
      expect(target.querySelector(".mobile-back")).toBe(back);
      expect(target.querySelector(".detail .state")?.textContent).toContain(
        "could not be loaded",
      );
      await act(async () => back?.click());
      expect(
        target.querySelector(".workspace")?.classList.contains("has-selection"),
      ).toBe(false);
      await new Promise((resolve) => requestAnimationFrame(resolve));
      expect(document.activeElement).toBe(resource);
    } finally {
      await act(async () => root.unmount());
      target.remove();
      vi.unstubAllGlobals();
    }
  });

  it("keeps edited text when resource navigation is cancelled", async () => {
    Object.assign(globalThis, { IS_REACT_ACT_ENVIRONMENT: true });
    const file = { ...image, name: "notes.txt", mediaType: "text/plain" };
    vi.spyOn(api, "session").mockResolvedValue(session);
    vi.spyOn(api, "list").mockResolvedValue({
      folder,
      resources: [file, childFolder],
    });
    vi.spyOn(api, "details").mockImplementation(async (id) => ({
      resource: id === file.id ? file : childFolder,
      breadcrumbs: [folder, id === file.id ? file : childFolder],
      shares: [],
    }));
    vi.spyOn(api, "content").mockResolvedValue({
      text: async () => "Original",
    } as Blob);
    const confirm = vi.spyOn(window, "confirm").mockReturnValue(false);
    const target = document.createElement("div");
    document.body.append(target);
    const root = createRoot(target);
    await act(async () => root.render(<App />));
    const button = (name: string) =>
      [...target.querySelectorAll("button")].find((item) =>
        item.textContent?.includes(name),
      );
    try {
      await act(async () => button("notes.txt")?.click());
      const input = target.querySelector("textarea");
      if (!input) throw new Error("Text editor was not rendered");
      await act(async () => {
        Object.getOwnPropertyDescriptor(
          HTMLTextAreaElement.prototype,
          "value",
        )?.set?.call(input, "Unsaved notes");
        input.dispatchEvent(new Event("input", { bubbles: true }));
      });
      await act(async () => button("Launch assets")?.click());
      await act(async () => {
        button("Launch assets")?.dispatchEvent(
          new MouseEvent("click", { bubbles: true, detail: 2 }),
        );
        button("Launch assets")?.dispatchEvent(
          new MouseEvent("dblclick", { bubbles: true }),
        );
      });
      expect(confirm).toHaveBeenCalledOnce();
      expect(api.list).toHaveBeenCalledTimes(1);
      expect(target.querySelector("textarea")?.value).toBe("Unsaved notes");
      confirm.mockReturnValue(true);
      await act(async () => button("Launch assets")?.click());
      expect(target.querySelector(".detail-title h2")?.textContent).toBe(
        childFolder.name,
      );
    } finally {
      await act(async () => root.unmount());
      target.remove();
    }
  });

  it("opens a move destination browser even when the current folder has no subfolders", async () => {
    Object.assign(globalThis, { IS_REACT_ACT_ENVIRONMENT: true });
    const file = { ...image, parentId: childFolder.id };
    vi.spyOn(api, "session").mockResolvedValue(session);
    vi.spyOn(api, "list").mockImplementation(async (id) =>
      id === folder.id
        ? { folder, resources: [childFolder, secondFolder] }
        : id === secondFolder.id
          ? { folder: secondFolder, resources: [] }
          : { folder: childFolder, resources: [file] },
    );
    vi.spyOn(api, "details").mockResolvedValue({
      resource: file,
      breadcrumbs: [folder, childFolder, file],
      shares: [],
    });
    vi.spyOn(api, "content").mockResolvedValue(new Blob(["image"]));
    vi.spyOn(api, "move").mockResolvedValue({
      resource: { ...file, parentId: secondFolder.id },
    });
    Object.defineProperties(URL, {
      createObjectURL: { configurable: true, value: () => "blob:test" },
      revokeObjectURL: { configurable: true, value: vi.fn() },
    });
    const target = document.createElement("div");
    document.body.append(target);
    const root = createRoot(target);
    await act(async () => root.render(<App />));
    const button = (name: string) =>
      [...target.querySelectorAll("button")].find(
        (item) => item.textContent === name,
      );
    try {
      await act(async () =>
        target.querySelector<HTMLButtonElement>(".resource-row")?.click(),
      );
      expect(button("Move")?.disabled).toBe(false);
      await act(async () => button("Move")?.click());
      expect(target.querySelector('[role="dialog"] header')).toBeNull();
      await act(async () =>
        [
          ...target.querySelectorAll<HTMLButtonElement>(
            '[role="dialog"] button',
          ),
        ]
          .find((item) => item.textContent === "Parent folder")
          ?.click(),
      );
      await act(async () => button("Archive")?.click());
      const form = target.querySelector(".dialog-form");
      if (!form) throw new Error("Move form was not rendered");
      await act(async () =>
        form.dispatchEvent(
          new Event("submit", { bubbles: true, cancelable: true }),
        ),
      );
      expect(api.move).toHaveBeenCalledWith(
        file,
        secondFolder.id,
        session.csrfToken,
      );
    } finally {
      await act(async () => root.unmount());
      target.remove();
    }
  });
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
