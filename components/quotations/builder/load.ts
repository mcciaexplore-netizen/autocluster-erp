import "server-only";
import { getCustomersForPicker, getDepartments, getNextQuoteNoPreview, getServices, getSettings } from "@/lib/data";
import { getServiceMaterials } from "@/lib/inventory-data";
import type { BuilderCustomer } from "./quotation-builder";

export async function loadBuilderData() {
  const [customers, departments, services, settings, nextQuoteNo, materials] = await Promise.all([
    getCustomersForPicker(),
    getDepartments(),
    getServices(),
    getSettings(),
    getNextQuoteNoPreview(),
    getServiceMaterials(),
  ]);
  const builderCustomers: BuilderCustomer[] = customers.map((c) => ({
    id: c.id,
    companyName: c.companyName,
    category: c.category,
    addressLine1: c.addressLine1,
    addressLine2: c.addressLine2,
    city: c.city,
    state: c.state,
    stateCode: c.stateCode,
    pincode: c.pincode,
    gstRegistered: c.gstRegistered,
    gstin: c.gstin,
    pan: c.pan,
    tan: c.tan,
    udyamNo: c.udyamNo,
    pocName: c.pocName,
    pocDesignation: c.pocDesignation,
    pocPhone: c.pocPhone,
    pocEmail: c.pocEmail,
    isMcciaMember: c.isMcciaMember,
    mcciaMembershipId: c.mcciaMembershipId,
    deptCodes: c.deptCodes,
    serviceIds: c.serviceIds,
  }));
  return { customers: builderCustomers, departments, services, settings, nextQuoteNo, materials };
}
