"use client";

import {
    SiPostgresql,
    SiMysql,
    SiGooglebigquery,
    SiSnowflake,
    SiMongodb,
} from "react-icons/si";
import type { IconType } from "react-icons";
import { TbDatabase, TbServer2 } from "react-icons/tb";

/**
 * Brand icons for every connector we support.
 *
 * Simple Icons (react-icons/si) ships authentic marks for: Postgres,
 * MySQL, MongoDB, Snowflake, BigQuery. For brands it doesn't cover
 * (Oracle, Redshift, MSSQL) we fall back to Tabler's database/server
 * glyphs tinted with the brand's official colour — still recognisable,
 * never a lazy letter glyph.
 */

export type ConnectorType =
    | "postgres"
    | "mysql"
    | "mssql"
    | "oracle"
    | "bigquery"
    | "snowflake"
    | "redshift"
    | "mongodb";

const BRAND_COLOR: Record<ConnectorType, string> = {
    postgres: "#336791",
    mysql: "#4479A1",
    mssql: "#A91D22",
    oracle: "#F80000",
    bigquery: "#669DF6",
    snowflake: "#29B5E8",
    redshift: "#8C4FFF",
    mongodb: "#47A248",
};

const ICON_MAP: Record<ConnectorType, IconType> = {
    postgres: SiPostgresql,
    mysql: SiMysql,
    mssql: TbServer2 as unknown as IconType,
    oracle: TbDatabase as unknown as IconType,
    bigquery: SiGooglebigquery,
    snowflake: SiSnowflake,
    redshift: TbDatabase as unknown as IconType,
    mongodb: SiMongodb,
};

interface Props {
    type: ConnectorType;
    size?: number;
    brand?: boolean;
    className?: string;
}

export default function ConnectorIcon({
    type,
    size = 28,
    brand = true,
    className,
}: Props) {
    const Icon = ICON_MAP[type] || (TbDatabase as unknown as IconType);
    const color = brand ? BRAND_COLOR[type] : "currentColor";
    return (
        <span className={className} style={{ display: "inline-flex", lineHeight: 0 }}>
            <Icon size={size} color={color} aria-hidden />
        </span>
    );
}

export function connectorBrandColor(type: ConnectorType): string {
    return BRAND_COLOR[type] || "currentColor";
}
