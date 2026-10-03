import type { ComponentProps } from 'react'
import { FontAwesomeIcon } from '@fortawesome/react-fontawesome'
import {
  faArrowDown, faArrowLeft, faArrowRight, faArrowUp, faBars, faBell,
  faBolt, faBuilding, faCalculator, faCalendarDays, faChartSimple, faCheck, faChevronDown,
  faCircleCheck, faDesktop, faFileInvoice, faLayerGroup, faMagnifyingGlass,
  faMobileScreen, faPlug, faPlus, faSearch, faSliders, faSun, faTag, faUsers, faXmark,
} from '@fortawesome/free-solid-svg-icons'

const icons = {
  left: faArrowLeft, right: faArrowRight, up: faArrowUp, down: faArrowDown,
  overview: faLayerGroup, energy: faBolt, invoices: faFileInvoice, participants: faUsers,
  communities: faBuilding, accounts: faUsers, profile: faUsers,
  metering: faChartSimple, reports: faFileInvoice, meteringPoints: faPlug,
  tariffs: faTag, feasibility: faCalculator, annualStatement: faFileInvoice, templates: faFileInvoice,
  building: faBuilding, calendar: faCalendarDays, search: faMagnifyingGlass,
  bell: faBell, check: faCheck, complete: faCircleCheck, chevron: faChevronDown,
  desktop: faDesktop, mobile: faMobileScreen, close: faXmark, plus: faPlus,
  sun: faSun, chart: faChartSimple, settings: faSliders, menu: faBars, zoom: faSearch,
}

export function LabIcon({ name, ...props }: { name: keyof typeof icons } & Omit<ComponentProps<typeof FontAwesomeIcon>, 'icon'>) {
  return <FontAwesomeIcon icon={icons[name]} fixedWidth aria-hidden="true" {...props} />
}
