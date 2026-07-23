import { Router } from "express";
import { z } from "zod";
import type { RoleSlug } from "@docs-organizer/shared";
import {
  createUserWithPassword,
  deleteSessionsForUser,
  findUserByEmail,
  findUserById,
  listRoles,
  listUsersAdmin,
  setUserPassword,
  assignRoles,
  updateUserDetails,
} from "../db/users.js";
import {
  createTeam,
  deleteTeam,
  getTeam,
  listTeams,
  setTeamMembers,
  updateTeam,
} from "../db/teams.js";
import {
  requireAuth,
  requireSuperUser,
  type AuthedRequest,
} from "../middleware/auth.js";

export const adminRouter = Router();

adminRouter.use(requireAuth, requireSuperUser);

const roleSlugSchema = z.enum(["user", "super_user", "team_member"]);

adminRouter.get("/roles", async (_req, res, next) => {
  try {
    const roles = await listRoles();
    res.json({ roles });
  } catch (err) {
    next(err);
  }
});

adminRouter.get("/users", async (_req, res, next) => {
  try {
    const users = await listUsersAdmin();
    res.json({ users });
  } catch (err) {
    next(err);
  }
});

adminRouter.post("/users", async (req, res, next) => {
  try {
    const body = z
      .object({
        email: z.string().email().max(320),
        password: z.string().min(8).max(200),
        name: z.string().min(1).max(120).nullable().optional(),
        roles: z.array(roleSlugSchema).optional(),
        emailVerified: z.boolean().optional(),
      })
      .parse(req.body);

    const existing = await findUserByEmail(body.email);
    if (existing) {
      res.status(409).json({ error: "An account with this email already exists" });
      return;
    }

    const user = await createUserWithPassword({
      email: body.email,
      password: body.password,
      name: body.name,
      roles: (body.roles as RoleSlug[] | undefined) ?? ["user"],
      emailVerified: body.emailVerified,
    });

    const adminUser = (await listUsersAdmin()).find((u) => u.id === user.id);
    res.status(201).json({ user: adminUser ?? user });
  } catch (err) {
    next(err);
  }
});

adminRouter.patch("/users/:id", async (req, res, next) => {
  try {
    const id = Array.isArray(req.params.id) ? req.params.id[0] : req.params.id;
    const body = z
      .object({
        email: z.string().email().max(320).optional(),
        name: z.string().min(1).max(120).nullable().optional(),
        emailVerified: z.boolean().optional(),
      })
      .parse(req.body);

    const existing = await findUserById(id);
    if (!existing) {
      res.status(404).json({ error: "User not found" });
      return;
    }

    if (body.email && body.email.toLowerCase() !== existing.email.toLowerCase()) {
      const clash = await findUserByEmail(body.email);
      if (clash && clash.id !== id) {
        res.status(409).json({ error: "An account with this email already exists" });
        return;
      }
    }

    await updateUserDetails(id, body);
    const adminUser = (await listUsersAdmin()).find((u) => u.id === id);
    res.json({ user: adminUser });
  } catch (err) {
    next(err);
  }
});

adminRouter.put("/users/:id/roles", async (req: AuthedRequest, res, next) => {
  try {
    const id = Array.isArray(req.params.id) ? req.params.id[0] : req.params.id;
    const body = z
      .object({
        roles: z.array(roleSlugSchema).min(1),
      })
      .parse(req.body);

    const existing = await findUserById(id);
    if (!existing) {
      res.status(404).json({ error: "User not found" });
      return;
    }

    const roles = body.roles as RoleSlug[];
    // Prevent locking yourself out of super_user
    if (
      req.user!.id === id &&
      existing.roles.includes("super_user") &&
      !roles.includes("super_user")
    ) {
      res.status(400).json({
        error: "You cannot remove your own Super User role",
      });
      return;
    }

    await assignRoles(id, roles);
    const adminUser = (await listUsersAdmin()).find((u) => u.id === id);
    res.json({ user: adminUser });
  } catch (err) {
    next(err);
  }
});

adminRouter.post("/users/:id/password", async (req, res, next) => {
  try {
    const id = Array.isArray(req.params.id) ? req.params.id[0] : req.params.id;
    const body = z
      .object({
        password: z.string().min(8).max(200),
        revokeSessions: z.boolean().optional(),
      })
      .parse(req.body);

    const existing = await findUserById(id);
    if (!existing) {
      res.status(404).json({ error: "User not found" });
      return;
    }

    await setUserPassword(id, body.password);
    if (body.revokeSessions !== false) {
      await deleteSessionsForUser(id);
    }
    res.status(204).send();
  } catch (err) {
    next(err);
  }
});

adminRouter.get("/teams", async (_req, res, next) => {
  try {
    const teams = await listTeams();
    res.json({ teams });
  } catch (err) {
    next(err);
  }
});

adminRouter.post("/teams", async (req, res, next) => {
  try {
    const body = z
      .object({
        name: z.string().min(1).max(120),
        description: z.string().max(500).nullable().optional(),
        memberIds: z.array(z.string().uuid()).optional(),
      })
      .parse(req.body);

    const team = await createTeam({
      name: body.name,
      description: body.description,
    });
    if (body.memberIds?.length) {
      const updated = await setTeamMembers(team.id, body.memberIds);
      res.status(201).json({ team: updated });
      return;
    }
    res.status(201).json({ team });
  } catch (err) {
    next(err);
  }
});

adminRouter.patch("/teams/:id", async (req, res, next) => {
  try {
    const id = Array.isArray(req.params.id) ? req.params.id[0] : req.params.id;
    const body = z
      .object({
        name: z.string().min(1).max(120).optional(),
        description: z.string().max(500).nullable().optional(),
      })
      .parse(req.body);

    const existing = await getTeam(id);
    if (!existing) {
      res.status(404).json({ error: "Team not found" });
      return;
    }

    const team = await updateTeam(id, body);
    res.json({ team });
  } catch (err) {
    next(err);
  }
});

adminRouter.put("/teams/:id/members", async (req, res, next) => {
  try {
    const id = Array.isArray(req.params.id) ? req.params.id[0] : req.params.id;
    const body = z
      .object({
        memberIds: z.array(z.string().uuid()),
      })
      .parse(req.body);

    const existing = await getTeam(id);
    if (!existing) {
      res.status(404).json({ error: "Team not found" });
      return;
    }

    const team = await setTeamMembers(id, body.memberIds);
    res.json({ team });
  } catch (err) {
    next(err);
  }
});

adminRouter.delete("/teams/:id", async (req: AuthedRequest, res, next) => {
  try {
    const id = Array.isArray(req.params.id) ? req.params.id[0] : req.params.id;
    const existing = await getTeam(id);
    if (!existing) {
      res.status(404).json({ error: "Team not found" });
      return;
    }
    await deleteTeam(id);
    res.status(204).send();
  } catch (err) {
    next(err);
  }
});
