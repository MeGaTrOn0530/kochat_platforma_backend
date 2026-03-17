import express from "express";
import cors from "cors";
import helmet from "helmet";
import morgan from "morgan";
import cookieParser from "cookie-parser";
import env from "./config/env.js";
import apiRouter from "./routes/index.js";
import { errorHandler, notFoundHandler } from "./middlewares/error.middleware.js";
import { getUploadRoot } from "./utils/upload-storage.js";

const app = express();

const corsOptions = {
  origin: env.corsOrigin === "*" ? true : env.corsOrigin.split(",").map((item) => item.trim()),
  credentials: true
};

app.use(
  helmet({
    crossOriginResourcePolicy: {
      policy: "cross-origin",
    },
  })
);
app.use(cors(corsOptions));
app.use(morgan("dev"));
app.use(express.json({ limit: "15mb" }));
app.use(express.urlencoded({ extended: true }));
app.use(cookieParser());
app.use("/uploads", express.static(getUploadRoot()));

app.get("/health", (req, res) => {
  res.json({
    success: true,
    message: "Server ishlayapti"
  });
});

app.use("/api", apiRouter);
app.use(notFoundHandler);
app.use(errorHandler);

export default app;
