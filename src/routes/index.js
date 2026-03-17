import { Router } from "express";
import authRoutes from "./auth.routes.js";
import usersRoutes from "./users.routes.js";
import locationsRoutes from "./locations.routes.js";
import catalogRoutes from "./catalog.routes.js";
import seedlingsRoutes from "./seedlings.routes.js";
import transfersRoutes from "./transfers.routes.js";
import ordersRoutes from "./orders.routes.js";
import tasksRoutes from "./tasks.routes.js";
import reportsRoutes from "./reports.routes.js";
import dashboardRoutes from "./dashboard.routes.js";
import customerProductsRoutes from "./customer-products.routes.js";
import notificationsRoutes from "./notifications.routes.js";

const router = Router();

router.use("/auth", authRoutes);
router.use("/users", usersRoutes);
router.use("/locations", locationsRoutes);
router.use("/catalog", catalogRoutes);
router.use("/seedlings", seedlingsRoutes);
router.use("/transfers", transfersRoutes);
router.use("/orders", ordersRoutes);
router.use("/tasks", tasksRoutes);
router.use("/reports", reportsRoutes);
router.use("/dashboard", dashboardRoutes);
router.use("/customer-products", customerProductsRoutes);
router.use("/notifications", notificationsRoutes);

export default router;
