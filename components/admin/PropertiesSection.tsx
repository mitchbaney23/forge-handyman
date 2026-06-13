import { Icon } from "@/lib/icons";
import type { CustomerProperty } from "@/lib/data";

export interface PropertiesSectionProps {
  // The customer's jobs grouped by normalized address (derived server-side in
  // getCustomerById → deriveProperties). A landlord has one email, many
  // properties; this is how the profile separates them.
  properties: CustomerProperty[];
}

// "Properties (N)" — one card per distinct address with its job count and last
// job date. Empty state covers a customer with no addressed jobs yet.
export function PropertiesSection({ properties }: PropertiesSectionProps) {
  return (
    <section>
      <div className="mb-3">
        <h2 className="text-lg font-semibold text-navy">
          Properties
          <span className="ml-2 text-sm font-normal text-ink/50">
            {properties.length}
          </span>
        </h2>
      </div>
      {properties.length === 0 ? (
        <div className="rounded-lg border border-dashed border-navy/15 bg-white/50 p-6 text-center text-sm text-ink/55">
          No properties on file yet.
        </div>
      ) : (
        <div className="grid gap-3 sm:grid-cols-2">
          {properties.map((property) => (
            <div
              key={property.address}
              className="rounded-lg border border-navy/10 bg-white p-4"
            >
              <div className="flex items-start gap-2">
                <Icon
                  name="map-pin"
                  className="mt-0.5 h-4 w-4 shrink-0 text-ink/45"
                  aria-hidden="true"
                />
                <div className="min-w-0">
                  <div className="text-sm font-medium text-navy">
                    {property.address}
                  </div>
                  <div className="mt-1 flex flex-wrap gap-x-4 gap-y-0.5 text-xs text-ink/55">
                    <span>
                      {property.jobCount}{" "}
                      {property.jobCount === "1" ? "job" : "jobs"}
                    </span>
                    <span>Last job {formatDate(property.lastJobAt)}</span>
                  </div>
                </div>
              </div>
            </div>
          ))}
        </div>
      )}
    </section>
  );
}

function formatDate(iso: string): string {
  if (!iso) return "—";
  const d = new Date(iso);
  if (Number.isNaN(d.getTime())) return iso;
  return d.toLocaleDateString(undefined, {
    year: "numeric",
    month: "short",
    day: "numeric",
  });
}
