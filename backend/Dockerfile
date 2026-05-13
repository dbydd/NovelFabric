FROM rust:1.85-bookworm AS builder
WORKDIR /app
COPY Cargo.toml Cargo.lock ./
COPY src ./src
RUN cargo build --release

FROM debian:bookworm-slim
WORKDIR /app
COPY --from=builder /app/target/release/novelfabric-backend /usr/local/bin/novelfabric-backend
ENV NOVELFABRIC_BACKEND_BIND_ADDRESS=0.0.0.0:50000
ENV NOVELFABRIC_DATA_DIR=/app/data
EXPOSE 50000
CMD ["novelfabric-backend"]
