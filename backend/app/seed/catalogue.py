"""Static mock-data catalogues: realistic, fictional Bristol and Bath painting and decorating.

Every person, company and street address here is invented. Phone numbers use the Ofcom drama
range (07700 900xxx) and emails use the reserved-for-examples style domain.
"""

from dataclasses import dataclass

from app.models.enums import CustomerType, JobType

I, E, W, K, S, C = (
    JobType.interior_repaint,
    JobType.exterior_repaint,
    JobType.wallpapering,
    JobType.kitchen_cabinet_spray,
    JobType.staircase_woodwork,
    JobType.commercial_unit,
)

MANAGER = ("Sarah Whitfield", "manager@jobproof.test", "07700 900100")
# (full name, email, phone, password or None)
PAINTERS: list[tuple[str, str, str, str | None]] = [
    ("Dan Hughes", "painter@jobproof.test", "07700 900101", "Painter123!"),
    ("Priya Shah", "priya.shah@jobproof.test", "07700 900102", None),
    ("Tom Bennett", "tom.bennett@jobproof.test", "07700 900103", None),
    ("Gareth Lewis", "gareth.lewis@jobproof.test", "07700 900104", None),
    ("Kasia Nowak", "kasia.nowak@jobproof.test", "07700 900105", None),
    ("Liam O'Connor", "liam.oconnor@jobproof.test", "07700 900106", None),
]
MANAGER_PASSWORD = "Manager123!"  # noqa: S105 - published demo credential
# Jobs per painter (Dan Hughes has 10; each painter has 7 to 13). Sums to 60.
PAINTER_QUOTAS = [10, 11, 9, 12, 8, 10]

DEMO_ACCOUNTS: list[dict[str, str]] = [
    {
        "role": "manager",
        "email": MANAGER[1],
        "password": MANAGER_PASSWORD,
        "full_name": MANAGER[0],
    },
    {
        "role": "painter",
        "email": PAINTERS[0][1],
        "password": PAINTERS[0][3] or "",
        "full_name": PAINTERS[0][0],
    },
]


@dataclass(frozen=True)
class Address:
    line1: str
    town: str
    county: str
    postcode: str
    line2: str | None = None


def _bristol(line1: str, postcode: str, line2: str | None = None) -> Address:
    return Address(line1, "Bristol", "City of Bristol", postcode, line2)


def _bath(line1: str, postcode: str, line2: str | None = None) -> Address:
    return Address(line1, "Bath", "Bath and North East Somerset", postcode, line2)


@dataclass(frozen=True)
class CustomerSpec:
    key: str
    customer_type: CustomerType
    name: str
    contact_name: str | None
    email: str
    phone: str
    billing: Address
    terms_days: int
    notes: str | None
    sites: tuple[Address, ...]  # empty = jobs are at the billing address
    job_types: tuple[JobType, ...]


LONG_SITE = _bristol(
    "Flat 14, The Old Chapel Apartments, 112-118 St Michael's Hill Road",
    "BS2 8DT",
    "Kingsdown Conservation Area (rear entrance via Montague Place)",
)

HARBOURSIDE_SITES = (
    _bristol("Flat 3, 18 Alma Vale Road", "BS8 2HY"),
    LONG_SITE,
    _bristol("Flat 1, 7 Cotham Road South", "BS6 5TZ"),
    _bristol("27 Beaconsfield Road", "BS8 2TS"),
    _bristol("Flat 5, 61 Hotwell Road", "BS8 4UB"),
    _bristol("14 Somerset Terrace", "BS3 4SP"),
    _bristol("Flat 2, 33 Whiteladies Road", "BS8 2LS"),
    _bristol("9 Pembroke Vale", "BS8 3DW"),
    _bristol("Flat 6, 4 Park Row", "BS1 5LJ"),
    _bristol("52 Chesterfield Road", "BS6 5DW"),
    _bristol("Flat 4, 21 Princess Victoria Street", "BS8 4BX"),
    _bristol("18 Hampton Road", "BS6 6JB"),
)
CLIFTON_SITES = (
    _bristol("Flat 2, 8 Royal York Crescent", "BS8 4JZ"),
    _bristol("34 Cranbrook Road", "BS6 7BS"),
    _bristol("Ground Floor Flat, 15 Redland Park", "BS6 6SD"),
    _bristol("Flat 3, 2 Worcester Terrace", "BS8 3JW"),
    _bristol("46 Salisbury Road", "BS6 7AR"),
    _bristol("Top Flat, 11 Manilla Road", "BS8 4EN"),
    _bristol("19 Elmgrove Road", "BS6 6AH"),
    _bristol("Flat 1, 62 Pembroke Road", "BS8 3EG"),
)
LARDER_SITES = (
    _bristol("The Larder Café, 211 Gloucester Road", "BS7 8NU"),
    _bath("The Larder Café, 14 Walcot Street", "BA1 5BG"),
    _bristol("The Larder Café & Bakehouse, 3 Wapping Wharf Yard", "BS1 6UD"),
)
DENTAL_SITE = _bristol("Wells Road Dental Practice, 214 Wells Road", "BS4 2PN")

CUSTOMERS: list[CustomerSpec] = [
    CustomerSpec(
        "harbourside",
        CustomerType.landlord,
        "Harbourside Lettings Ltd",
        "Marcus Ellery",
        "accounts.harbourside@example.co.uk",
        "07700 900201",
        _bristol("Unit 4, Welsh Back Court", "BS1 4SB"),
        30,
        "Portfolio of rental flats across Clifton, Kingsdown and Southville. "
        "Invoices go to accounts, quoting the property address.",
        HARBOURSIDE_SITES,
        (I, I, I, I, E, E, W, W, K, K, S, S),
    ),
    CustomerSpec(
        "clifton",
        CustomerType.landlord,
        "Clifton & Redland Property Co.",
        "Fiona Calloway",
        "office.cliftonredland@example.co.uk",
        "07700 900202",
        _bristol("Second Floor, 76 Whiteladies Road", "BS8 2QP"),
        30,
        "Keys held at the office. Tenants need 48 hours' notice before access.",
        CLIFTON_SITES,
        (I, I, I, E, W, K, K, S),
    ),
    CustomerSpec(
        "larder",
        CustomerType.business,
        "The Larder Café Group",
        "Joe Abbott",
        "joe.abbott@example.co.uk",
        "07700 900203",
        _bristol("Unit 2, Feeder Road Business Park", "BS2 0TQ"),
        30,
        "Three cafés (Bristol and Bath). Works are done out of hours, after 6pm or on Mondays.",
        LARDER_SITES,
        (C, C, C, C, I, S),
    ),
    CustomerSpec(
        "dental",
        CustomerType.business,
        "Wells Road Dental Practice",
        "Gemma Ridley",
        "practice.manager.wellsroad@example.co.uk",
        "07700 900204",
        DENTAL_SITE,
        30,
        "Treatment rooms must be clear and dust-free by 8am. Low-odour paints only.",
        (DENTAL_SITE,),
        (C, C, I, I, W),
    ),
    CustomerSpec(
        "marsh",
        CustomerType.homeowner,
        "Helen & David Marsh",
        None,
        "helen.marsh@example.co.uk",
        "07700 900211",
        _bristol("22 Alexandra Park", "BS6 6QB"),
        14,
        "Two dogs, please keep the side gate closed.",
        (),
        (I, I, E, E, W, S),
    ),
    CustomerSpec(
        "patel",
        CustomerType.homeowner,
        "Rajesh Patel",
        None,
        "rajesh.patel@example.co.uk",
        "07700 900212",
        _bristol("9 Cotham Vale", "BS6 6HR"),
        14,
        None,
        (),
        (I, I, E, W, K),
    ),
    CustomerSpec(
        "trenchard",
        CustomerType.homeowner,
        "Olivia Trenchard",
        None,
        "olivia.trenchard@example.co.uk",
        "07700 900213",
        _bath("5 Lyncombe Hill", "BA2 4PH"),
        14,
        "Listed building: check colour choices against the conservation officer's notes.",
        (),
        (I, E, K, S),
    ),
    CustomerSpec(
        "baines",
        CustomerType.homeowner,
        "Callum Baines",
        None,
        "callum.baines@example.co.uk",
        "07700 900214",
        _bristol("118 Ashley Down Road", "BS7 9JR"),
        14,
        None,
        (),
        (I, E, W, S),
    ),
    CustomerSpec(
        "hargreaves",
        CustomerType.homeowner,
        "Sophie Hargreaves",
        None,
        "sophie.hargreaves@example.co.uk",
        "07700 900215",
        _bath("17 Combe Park", "BA1 3NP"),
        14,
        None,
        (),
        (I, E, K),
    ),
    CustomerSpec(
        "pettigrew",
        CustomerType.homeowner,
        "Ian & Joan Pettigrew",
        None,
        "pettigrew.family@example.co.uk",
        "07700 900216",
        _bristol("8 Church Road", "BS4 2NH"),
        14,
        "Prefer morning starts. Parking on the drive is fine.",
        (),
        (W, S, K),
    ),
    CustomerSpec(
        "nwosu",
        CustomerType.homeowner,
        "Amara Nwosu",
        None,
        "amara.nwosu@example.co.uk",
        "07700 900217",
        _bristol("25 Ashgrove Road", "BS7 9LQ"),
        14,
        None,
        (),
        (I, S),
    ),
    CustomerSpec(
        "whitcombe",
        CustomerType.homeowner,
        "Eleanor Whitcombe",
        None,
        "eleanor.whitcombe@example.co.uk",
        "07700 900218",
        _bath("Flat 2, 4 Great Pulteney Street", "BA2 4BR"),
        14,
        "Shared hallway: protect the communal carpet and tell the neighbours before sanding.",
        (),
        (E, W),
    ),
]

TITLES: dict[JobType, list[str]] = {
    I: [
        "Hallway, stairs and landing repaint",
        "Lounge and dining room repaint",
        "Master bedroom and ensuite repaint",
        "Full ground floor repaint",
        "Open-plan kitchen diner repaint",
        "Two bedrooms and box room repaint",
        "Living room ceiling and walls, white to soft grey",
        "Flat refresh: all rooms, magnolia to white",
        "Bathroom, cloakroom and hallway repaint",
        "Snug and study repaint with feature wall",
    ],
    E: [
        "Front elevation masonry repaint",
        "Rear and side elevations repaint",
        "Windows, fascias and soffits repaint",
        "Full exterior repaint, render and woodwork",
        "Front door, porch and railings",
        "Bay windows and sash frames: prep and repaint",
        "Garden wall and gate repaint",
        "Gable end and chimney stack repaint",
    ],
    W: [
        "Hallway and landing wallpaper",
        "Feature wall: lining paper and hang",
        "Bedroom strip and hang",
        "Dining room paste-the-wall wallpaper",
        "Nursery wallpaper and border",
        "Snug floral wallpaper, two walls",
        "Stairwell wallpaper (tall drop)",
    ],
    K: [
        "Spray kitchen cabinet doors and drawer fronts",
        "Respray shaker kitchen, 14 doors",
        "Kitchen units: degrease, prime and spray",
        "Utility room cabinets spray",
        "Kitchen island and wall units respray",
        "Oak kitchen to satin sage green",
    ],
    S: [
        "Staircase spindles, newel posts and handrail",
        "Strip and repaint staircase and banister",
        "Skirting, architraves and staircase gloss",
        "Hall woodwork: doors, frames and stair stringer",
        "Victorian staircase restoration repaint",
        "Landing balustrade and skirting repaint",
    ],
    C: [
        "Café front-of-house repaint, out of hours",
        "Kitchen and prep area wipeable paint",
        "Waiting room and reception repaint",
        "Surgeries 1 to 3: antibacterial paint",
        "Corridor and stairwell repaint",
        "Shopfront and fascia repaint",
        "Staff room and toilets repaint",
        "Seating area, ceiling and feature wall",
    ],
}

JOB_NOTES: dict[JobType, list[str]] = {
    I: [
        "Customer has chosen the colours: swatches are on the hallway windowsill. Dust sheets for all furniture.",
        "Key safe by the front door; code sent to the painter by text. Park on the street.",
        "Walls are in good condition apart from a few hairline cracks. Fill and sand before priming.",
        "Customer works from home on Tuesdays and Thursdays, so keep noise down before 10am.",
        "Previous owner used a high-sheen paint. Mist coat needed before the two top coats.",
    ],
    E: [
        "Scaffold tower required for the front elevation. Weather dependent, rebook if rain is forecast.",
        "Masonry is chalky in places. Wash down, apply stabilising solution, then two coats of masonry paint.",
        "Protect the climbers on the south wall and tie them back before starting.",
        "Neighbour has agreed access to the side passage for the ladder.",
        "Check window putty and renew where cracked before painting the frames.",
    ],
    W: [
        "Customer supplied the paper (six rolls plus two spare). Pattern repeat is 64cm, allow for waste.",
        "Existing paper needs stripping first. Steamer in the van. Lining paper on the bare plaster.",
        "Walls are uneven near the chimney breast: cross-line before hanging.",
        "Paste-the-wall paper, so no soaking needed. Keep offcuts for the customer.",
    ],
    K: [
        "Doors and drawer fronts come off and are sprayed in the workshop. Hinges and handles to be bagged and labelled.",
        "Customer wants a satin finish in a deep green. Test spray on one door first.",
        "Cabinet frames masked and sprayed in place. Extractor fan to be left running.",
        "Allow for a four-day cure before the doors are rehung.",
    ],
    S: [
        "Spindles are chipped in places. Fill, sand and prime, then satin finish. Carpet runner to be protected with hardboard.",
        "Handrail is stained oak; customer wants it left natural and the rest painted white.",
        "Old gloss is peeling on the treads. Strip back to sound paint and re-prime.",
        "Work stairs one side at a time so the household can still use them.",
    ],
    C: [
        "Out of hours only. Manager will leave the keys with the neighbouring shop. Alarm code on the job sheet.",
        "Use washable matt for the walls and satin on the woodwork. All paint to be low odour.",
        "Floor and fixed equipment covered each evening. Everything must be re-opened by 7am.",
        "Health and safety file is on site: sign in and out at reception.",
    ],
}

PAINTER_NOTES: dict[JobType, list[str]] = {
    I: [
        "All rooms prepared, filled and sanded before painting.",
        "Two coats applied throughout with a mist coat first on the new plaster.",
        "Ceilings done in brilliant white. Woodwork in satin as agreed.",
        "Customer was happy with the colours once the second coat went on.",
        "Left spare paint labelled in the cupboard under the stairs.",
        "Found a small damp patch above the window; flagged to the customer.",
    ],
    E: [
        "Washed down and treated algae on the north wall before painting.",
        "Two full coats of masonry paint. Weather held, no rework needed.",
        "Replaced two lengths of rotten fascia filler and repainted.",
        "Tower taken down and the garden left tidy.",
        "Gutters masked and cleaned while we were up there.",
        "Customer asked for a touch up around the porch; done before leaving.",
    ],
    W: [
        "Walls lined first and left a day to dry. Paper hung with matching pattern at every join.",
        "Offcuts and one spare roll left with the customer.",
        "Corners and socket surrounds trimmed neatly. No bubbles after drying.",
        "Slight shade difference on one roll, hung it on the least visible wall.",
        "Stripped the old paper and skimmed two patches before lining.",
    ],
    K: [
        "Doors sprayed in the workshop, three coats of satin. Rehung and adjusted.",
        "Frames masked and sprayed on site. Clean finish, no runs.",
        "Customer asked for the handles to be refitted a little lower; done.",
        "Cure time explained: gentle use for a week, no harsh cleaners for a month.",
        "One drawer front was warped, replacement ordered.",
    ],
    S: [
        "Spindles and newel posts rubbed back and primed, two coats of satin on top.",
        "Handrail left natural and re-oiled. Treads painted in grey floor paint.",
        "Filled all chips and dents; sanded between coats for a smooth finish.",
        "Stairs kept usable throughout by working one side at a time.",
        "Hardboard removed and carpet runner checked for marks. All clear.",
    ],
    C: [
        "Worked evenings in two shifts. Everything re-opened on time for the morning.",
        "Washable matt on the walls, satin on the woodwork. Low odour paint used throughout.",
        "Floor covers and masking removed each night. Site left clean.",
        "Manager signed off the finish at handover.",
        "Touched up the skirting where the delivery trolley caught it.",
    ],
}

CHECKLISTS: dict[JobType, list[str]] = {
    I: [
        "Furniture moved and covered with dust sheets",
        "Walls filled and sanded",
        "Woodwork and skirting sanded and primed",
        "Ceilings painted, two coats",
        "Walls painted, two coats",
        "Woodwork painted in satin",
        "Sockets and switches masked and refitted",
        "Rooms cleaned and furniture put back",
        "Spare paint left labelled",
    ],
    E: [
        "Scaffold tower or ladders set up safely",
        "Surfaces pressure washed",
        "Algae and mould treated",
        "Cracks and loose render repaired",
        "Masonry stabilising solution applied",
        "Two coats of masonry paint applied",
        "Window frames and fascias sanded and repainted",
        "Gutters and downpipes masked and cleaned",
        "Garden left clean and tidy",
    ],
    W: [
        "Old paper stripped",
        "Walls filled and sanded",
        "Walls sized or lined",
        "Pattern matched and set out",
        "Paper hung and seams checked",
        "Corners, sockets and skirting trimmed",
        "Offcuts and spare roll left with customer",
        "Floors and surfaces cleaned",
    ],
    K: [
        "Doors and drawer fronts removed and labelled",
        "Cabinets degreased and sanded",
        "Primer applied",
        "Finish coats sprayed",
        "Hardware cleaned and refitted",
        "Doors rehung and aligned",
        "Worktops and appliances protected",
        "Aftercare advice given to customer",
    ],
    S: [
        "Stairs and floor protected",
        "Old paint stripped where flaking",
        "Chips and holes filled and sanded",
        "Spindles and newel posts primed",
        "Handrail prepared",
        "Undercoat applied",
        "Satin top coats applied",
        "Protection removed and area cleaned",
    ],
    C: [
        "Out-of-hours access agreed and keys logged",
        "Fixtures and equipment covered",
        "Surfaces cleaned and prepared",
        "Filler and sanding completed",
        "Primer or mist coat applied",
        "Two finish coats applied",
        "Woodwork and doors painted",
        "Site cleaned and re-opened on time",
        "Manager sign-off obtained",
    ],
}

SNAG_NOTES = [
    "Small area by the window still needs a second coat. Painter to return.",
    "Customer asked for the door edge to be redone; booked a revisit.",
    "Spare paint not delivered yet. Will drop off with the next job.",
    "One socket surround needs touching up after the electrician's visit.",
    "Handle fixings to be replaced once the new ones arrive.",
]
CHECKLIST_DONE_NOTES = [
    "Customer checked and happy.",
    "Done in two coats.",
    "Colour matched to the sample.",
    "Completed on the final day.",
]

CAPTIONS: dict[JobType, dict[str, list[str]]] = {
    I: {
        "before": [
            "Before: water-stained ceiling in hallway",
            "Before: scuffed walls and chipped skirting",
            "Before: tired magnolia in the lounge",
            "Before: cracks above the door frame",
            "Before: furniture covered ready to start",
        ],
        "during": [
            "During: first coat on the lounge walls",
            "During: cutting in around the window",
            "During: filler sanded on the landing",
            "During: mist coat on new plaster",
            "During: woodwork primed",
        ],
        "after": [
            "After: finished lounge, two coats",
            "After: hallway complete with fresh skirting",
            "After: ceiling in brilliant white",
            "After: bedroom finished, furniture back",
            "After: clean cut lines at the window",
        ],
    },
    E: {
        "before": [
            "Before: flaking masonry on the front elevation",
            "Before: algae on the north wall",
            "Before: peeling paint on window frames",
            "Before: weathered fascia and soffit",
            "Before: scaffold tower in place",
        ],
        "during": [
            "During: pressure washing the render",
            "During: stabilising solution applied",
            "During: first masonry coat on the front",
            "During: frames sanded back",
            "During: cracks repaired and filled",
        ],
        "after": [
            "After: front elevation finished",
            "After: freshly painted window frames",
            "After: rear and side walls complete",
            "After: porch and front door",
            "After: garden tidy, tower removed",
        ],
    },
    W: {
        "before": [
            "Before: old paper on the landing",
            "Before: bare wall ready for lining",
            "Before: patchy walls in the bedroom",
            "Before: peeling border in the nursery",
        ],
        "during": [
            "During: lining paper up and drying",
            "During: first drop hung and aligned",
            "During: pattern matched at the corner",
            "During: trimming around the socket",
        ],
        "after": [
            "After: feature wall finished",
            "After: hallway with new wallpaper",
            "After: seams tight and pattern matched",
            "After: bedroom complete",
            "After: spare roll left for the customer",
        ],
    },
    K: {
        "before": [
            "Before: worn kitchen cabinets",
            "Before: doors numbered and removed",
            "Before: chipped drawer fronts",
            "Before: cabinets masked ready to spray",
        ],
        "during": [
            "During: doors racked in the spray booth",
            "During: primer coat on the frames",
            "During: first finish coat sprayed",
            "During: hinges and handles bagged and labelled",
        ],
        "after": [
            "After: finished doors rehung",
            "After: sage green satin finish",
            "After: island unit complete",
            "After: wall units and handles refitted",
            "After: kitchen cleaned and ready to use",
        ],
    },
    S: {
        "before": [
            "Before: chipped spindles and scuffed treads",
            "Before: peeling gloss on the handrail",
            "Before: protection laid on the stairs",
            "Before: worn newel post",
        ],
        "during": [
            "During: spindles sanded and primed",
            "During: filler applied to dents",
            "During: undercoat on the newel posts",
            "During: first satin coat on the stringer",
        ],
        "after": [
            "After: finished staircase from the hall",
            "After: spindles and handrail complete",
            "After: landing balustrade and skirting",
            "After: newel post close up",
            "After: protection removed",
        ],
    },
    C: {
        "before": [
            "Before: dated walls in the waiting room",
            "Before: scuffed corridor paintwork",
            "Before: covered equipment in the kitchen area",
            "Before: shopfront with peeling fascia",
        ],
        "during": [
            "During: first coat of washable matt",
            "During: ceilings cut in",
            "During: woodwork primed overnight",
            "During: masking along the shopfront",
        ],
        "after": [
            "After: reception finished",
            "After: corridor complete",
            "After: treatment room ready for use",
            "After: shopfront repainted",
            "After: site cleaned and re-opened",
        ],
    },
}

# Fixed text for the edge case: a long address with long job and painter notes.
LONG_JOB_NOTES = (
    "Tenant changeover at the Old Chapel Apartments, Kingsdown. The flat is on the first floor with "
    "a shared stair and a heavy fire door, so access is limited to the rear entrance via Montague "
    "Place; the front entrance on St Michael's Hill is for residents only. Keys are held by the "
    "managing agent on the ground floor: sign them out and back in each day. Parking is not "
    "allowed on site, so use the pay and display bays on Cotham Hill and bring the dust sheets up "
    "in two trips. The whole flat is to be repainted in the landlord's standard white: ceilings in "
    "brilliant white matt, walls in soft white matt and woodwork in white satin. The hallway has "
    "old damp marks beneath the cupboard which the landlord says have been treated, but please "
    "check them with the damp meter before priming and photograph the readings. The kitchen and "
    "bathroom need a mould-resistant paint. Communal areas must be left spotless each evening, "
    "with no paint, dust or masking tape on the shared stair. Noise restrictions apply: no power "
    "tools before 9am or after 5pm, and none at weekends. The tenant moves in on the Friday after "
    "completion, so the job cannot overrun. Invoice to Harbourside Lettings accounts, quoting the "
    "property address and job reference."
)
LONG_PAINTER_NOTES = (
    "Finished a day ahead of the tenant move-in. Hallway damp marks read dry on the meter (photos "
    "attached) so I sealed them with a stain-block primer before the top coats. The old kitchen "
    "ceiling had nicotine staining which needed two coats of stain block, so the kitchen took "
    "longer than planned. Bathroom walls and ceiling are done in the mould-resistant paint; the "
    "extractor fan is noisy and probably needs replacing, which I have flagged to the agent. "
    "Shared stair is clean and the fire door is undamaged. Keys returned to the managing agent at "
    "4:40pm and signed back in. Two tins of spare white left in the airing cupboard and labelled "
    "by room. The tenant's key worker called round on the last afternoon and was happy with the "
    "finish. No snags outstanding."
)
